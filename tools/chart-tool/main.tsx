import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { groupImportFiles, type FolderImportSong } from "@/taiko/adminFolderImport";
import { processSong } from "./pipeline";
import "./tool.css";

interface Bridge {
  pickFolder(): Promise<string | null>;
  listFiles(dir: string): Promise<{ name: string; path: string }[]>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  joinPath(dir: string, name: string): Promise<string>;
  openFolder(dir: string): Promise<void>;
  getSettings(): Promise<{ input?: string; output?: string }>;
  setSettings(s: { input?: string; output?: string }): Promise<void>;
}
const bridge = (window as unknown as { chartTool?: Bridge }).chartTool;

interface Row {
  song: FolderImportSong;
  paths: Record<string, string>;
  state: "wait" | "run" | "done" | "fail";
  step: string;
  bpm?: number;
}

const KEY_LABEL: Record<string, string> = {
  original: "原曲", metro: "Metro", midi: "MIDI", drums: "鼓", bass: "贝斯", vocals: "人声", other: "其他",
};

function App() {
  const [input, setInput] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    void bridge?.getSettings().then((s) => {
      if (s.output) setOutput(s.output);
      if (s.input) void scan(s.input);
    });
  }, []);

  async function scan(dir: string) {
    if (!bridge) return;
    setInput(dir);
    setFinished(false);
    const list = await bridge.listFiles(dir);
    const pathOf = new Map<File, string>();
    const files = list.map((f) => {
      const file = new File([], f.name);
      pathOf.set(file, f.path);
      return file;
    });
    const result = groupImportFiles(files);
    setIgnored(result.ignored);
    setRows(
      result.songs.map((song) => {
        const paths: Record<string, string> = {};
        for (const [k, f] of Object.entries(song.files)) if (f) paths[k] = pathOf.get(f)!;
        return { song, paths, state: "wait", step: song.files.midi ? "等待" : "缺少 MIDI" };
      }),
    );
  }

  async function pickInput() {
    const dir = await bridge?.pickFolder();
    if (!dir) return;
    await bridge!.setSettings({ input: dir, output });
    await scan(dir);
  }
  async function pickOutput() {
    const dir = await bridge?.pickFolder();
    if (!dir) return;
    setOutput(dir);
    await bridge!.setSettings({ input, output: dir });
  }

  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function run() {
    if (!bridge || !output) return;
    setRunning(true);
    setFinished(false);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (!row.paths["midi"]) { update(i, { state: "fail", step: "缺少 MIDI" }); continue; }
      update(i, { state: "run", step: "读取文件" });
      try {
        const files: FolderImportSong["files"] = {};
        for (const [k, p] of Object.entries(row.paths)) {
          const bytes = await bridge.readFile(p);
          const name = (row.song.files as Record<string, File>)[k]!.name;
          (files as Record<string, File>)[k] = new File([bytes as BlobPart], name);
        }
        const out = await processSong({ ...row.song, files }, (step) => update(i, { step }));
        await bridge.writeFile(await bridge.joinPath(output, out.jsonName), out.jsonText);
        if (out.png && out.pngName) await bridge.writeFile(await bridge.joinPath(output, out.pngName), out.png);
        update(i, { state: "done", step: out.png ? "已导出 JSON + PNG" : "已导出 JSON（无封面）", bpm: out.bpm });
      } catch (e) {
        update(i, { state: "fail", step: (e as Error).message });
      }
    }
    setRunning(false);
    setFinished(true);
  }

  const done = rows.filter((r) => r.state === "done").length;
  const failed = rows.filter((r) => r.state === "fail").length;

  if (!bridge) return <div className="wrap">请在桌面程序中打开此工具。</div>;

  return (
    <div className="wrap">
      <h1>AeroGame 谱面导出工具</h1>
      <div className="pick">
        <button disabled={running} onClick={() => void pickInput()}>选择歌曲文件夹</button>
        <span className="path">{input || "未选择"}</span>
      </div>
      <div className="pick">
        <button disabled={running} onClick={() => void pickOutput()}>选择导出文件夹</button>
        <span className="path">{output || "未选择"}</span>
      </div>

      <div className="list">
        {rows.length === 0 && <div className="empty">选择歌曲文件夹后，这里会列出识别到的歌曲</div>}
        {rows.map((r, i) => (
          <div key={r.song.key} className={`row ${r.state}`}>
            <div className="title">{r.song.title}</div>
            <div className="files">
              {Object.keys(r.paths).map((k) => KEY_LABEL[k] ?? k).join(" · ")}
            </div>
            <div className="bpm">{r.bpm ? `${r.bpm} BPM` : ""}</div>
            <div className="step">{r.step}</div>
            <span className="idx">{i + 1}</span>
          </div>
        ))}
        {ignored.length > 0 && <div className="empty">已忽略 {ignored.length} 个无法识别的文件</div>}
      </div>

      <div className="foot">
        <span>
          共 {rows.length} 首{running || finished ? `，完成 ${done}，失败 ${failed}` : ""}
        </span>
        {finished && (
          <button onClick={() => void bridge.openFolder(output)}>打开导出文件夹</button>
        )}
        <button className="primary" disabled={running || !rows.length || !output} onClick={() => void run()}>
          {running ? "导出中…" : "开始导出"}
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
