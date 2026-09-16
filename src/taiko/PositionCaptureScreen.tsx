import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RotateCcw, Upload } from "lucide-react";
import { PART_BY_ID, partOfNote } from "./laneLayouts";
import { midiManager } from "./midiInput";
import { renderPadArray } from "./stageRenderer";
import { stickManager, type StickPose } from "./stickInput";
import {
  CAPTURE_PARTS,
  clearStickCalibration,
  loadStickCalibration,
  makeCalibration,
  saveStickCalibration,
  summarizeSamples,
  validateCalibration,
  type CaptureGroups,
  type CapturePart,
  type StickCalibrationFile,
  type StickSample,
  type StickSide,
} from "./stickCalibration";

const SIDE_LABEL: Record<StickSide, string> = { l: "左棒", r: "右棒" };
const ORDER = CAPTURE_PARTS.flatMap((part) => ([{ part, side: "l" as const }, { part, side: "r" as const }]));

export function PositionCaptureScreen() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [groups, setGroups] = useState<CaptureGroups>(() => loadStickCalibration()?.groups ?? {});
  const [step, setStep] = useState(0);
  const [samples, setSamples] = useState<StickSample[]>([]);
  const [running, setRunning] = useState(false);
  const [stickReady, setStickReady] = useState(false);
  const [midiSeen, setMidiSeen] = useState(false);
  const [status, setStatus] = useState("连接鼓棒姿态和 MIDI 后开始");
  const stepRef = useRef(step); const runningRef = useRef(running); const samplesRef = useRef(samples);
  stepRef.current = step; runningRef.current = running; samplesRef.current = samples;
  const current = ORDER[Math.min(step, ORDER.length - 1)]!;
  const completed = ORDER.filter(({ part, side }) => Boolean(groups[part]?.[side])).length;
  const done = completed === ORDER.length && !running;

  useEffect(() => {
    const timer = window.setInterval(() => {
      const snap = stickManager.latest();
      setStickReady(Boolean(snap?.l && snap?.r));
    }, 120);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const off = midiManager.onNote((note) => {
      setMidiSeen(true);
      if (!runningRef.current) return;
      const target = ORDER[stepRef.current];
      if (!target) return;
      const actual = partOfNote(note);
      if (actual !== target.part) {
        setStatus(actual ? `收到${PART_BY_ID[actual].label}，请敲高亮鼓面` : `音符 ${note} 尚未映射`);
        return;
      }
      const snap = stickManager.latest();
      const pose: StickPose | null = snap?.[target.side] ?? null;
      if (!pose) { setStatus(`${SIDE_LABEL[target.side]}姿态已断开，请重试`); return; }
      const next = [...samplesRef.current, { ...pose, at: performance.now() }].slice(0, 3);
      setSamples(next);
      setStatus(`已捕捉 ${next.length}/3`);
      if (next.length === 3) {
        const summary = summarizeSamples(next);
        setGroups((old) => ({ ...old, [target.part]: { ...old[target.part], [target.side]: summary } }));
        setRunning(false);
        setSamples([]);
        window.setTimeout(() => {
          const nextStep = stepRef.current + 1;
          if (nextStep < ORDER.length) {
            setStep(nextStep); setRunning(true);
            const item = ORDER[nextStep]!;
            setStatus(`请用${SIDE_LABEL[item.side]}敲${PART_BY_ID[item.part].label} 3 次`);
          } else setStatus("全部位置已捕捉，请检查结果并保存");
        }, 350);
      }
    });
    return off;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    let raf = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = wrap.clientWidth * dpr; canvas.height = wrap.clientHeight * dpr;
      canvas.style.width = `${wrap.clientWidth}px`; canvas.style.height = `${wrap.clientHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(); const ro = new ResizeObserver(resize); ro.observe(wrap);
    const draw = (now: number) => {
      renderPadArray(ctx, canvas.clientWidth, canvas.clientHeight, { parts: CAPTURE_PARTS, flashes: {}, now, selected: runningRef.current ? ORDER[stepRef.current]?.part : null, sticks: stickManager.latest() });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const begin = () => {
    if (!stickReady) { setStatus("尚未收到完整的左右鼓棒姿态"); return; }
    const firstMissing = ORDER.findIndex(({ part, side }) => !groups[part]?.[side]);
    const next = firstMissing < 0 ? 0 : firstMissing;
    setStep(next); setSamples([]); setRunning(true);
    const item = ORDER[next]!;
    setStatus(`请用${SIDE_LABEL[item.side]}敲${PART_BY_ID[item.part].label} 3 次`);
  };
  const retest = (part: CapturePart, side: StickSide) => {
    const index = ORDER.findIndex((item) => item.part === part && item.side === side);
    setGroups((old) => ({ ...old, [part]: { ...old[part], [side]: undefined } }));
    setStep(index); setSamples([]); setRunning(true);
    setStatus(`重新测试：请用${SIDE_LABEL[side]}敲${PART_BY_ID[part].label} 3 次`);
  };
  const calibration = useMemo(() => makeCalibration(groups), [groups]);
  const save = () => { saveStickCalibration(calibration); setStatus("校准已保存并应用到鼓棒位置"); };
  const download = () => {
    const file = makeCalibration(groups); saveStickCalibration(file);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `pd2u-stick-calibration-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = validateCalibration(JSON.parse(await file.text()));
      if (!parsed) throw new Error();
      saveStickCalibration(parsed); setGroups(parsed.groups); setRunning(false); setSamples([]); setStatus("校准文件已导入并应用");
    } catch { setStatus("校准文件无效或鼓阵版本不匹配"); }
  };

  return (
    <div className="grid min-h-full gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div ref={wrapRef} className="relative min-h-[320px] overflow-hidden border border-[var(--taiko-line)] bg-[var(--taiko-paper)] lg:min-h-[540px]">
        <canvas ref={canvasRef} className="block h-full w-full" />
        <div className="absolute left-4 top-4 border border-[var(--taiko-line)] bg-[var(--taiko-paper)]/90 px-3 py-2 text-xs backdrop-blur">
          <div className="font-medium text-[var(--taiko-ink)]">{running ? `${PART_BY_ID[current.part].label} · ${SIDE_LABEL[current.side]}` : "位置捕捉"}</div>
          <div className="mt-1 text-[var(--taiko-ink)]/60">{status}</div>
        </div>
      </div>
      <aside className="flex min-w-0 flex-col gap-4">
        <section className="border border-[var(--taiko-line)] bg-[var(--taiko-surface)] p-4">
          <h2 className="text-sm font-medium">采集状态</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Status ok={stickReady} label="左右鼓棒姿态" />
            <Status ok={midiSeen} label="MIDI 击打信号" waiting="等待首次击打" />
          </div>
          <div className="mt-4 h-1.5 overflow-hidden bg-[var(--taiko-ink)]/15"><div className="h-full bg-[var(--taiko-accent)] transition-all" style={{ width: `${completed / ORDER.length * 100}%` }} /></div>
          <div className="mt-2 text-xs tabular-nums text-[var(--taiko-ink)]/55">{completed}/{ORDER.length} 组 · 每组 3 次</div>
          <button onClick={begin} disabled={running} className="mt-4 w-full border border-[var(--taiko-ink)] px-4 py-2 text-sm disabled:opacity-40">{completed ? "继续未完成项目" : "开始位置捕捉"}</button>
        </section>
        <section className="max-h-[320px] overflow-auto border border-[var(--taiko-line)] bg-[var(--taiko-surface)] p-3">
          {CAPTURE_PARTS.map((part) => (
            <div key={part} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-[var(--taiko-line)] py-2 last:border-0">
              <span className="truncate text-xs">{PART_BY_ID[part].label}</span>
              {(["l", "r"] as const).map((side) => { const g = groups[part]?.[side]; return <button key={side} onClick={() => retest(part, side)} className={`min-w-16 border px-2 py-1 text-[10px] ${g ? (g.spread > 6 ? "border-amber-400 text-amber-300" : "border-emerald-400/50 text-emerald-300") : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/45"}`}>{SIDE_LABEL[side]} {g ? `${g.spread.toFixed(1)}°` : "未采"}</button>; })}
            </div>
          ))}
        </section>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={save} disabled={!done} className="border border-[var(--taiko-ink)] px-3 py-2 text-xs disabled:opacity-30">保存并应用</button>
          <button onClick={download} disabled={!done} className="flex items-center justify-center gap-1 border border-[var(--taiko-line)] px-3 py-2 text-xs disabled:opacity-30"><Download size={14}/>导出文件</button>
          <button onClick={() => fileRef.current?.click()} className="flex items-center justify-center gap-1 border border-[var(--taiko-line)] px-3 py-2 text-xs"><Upload size={14}/>导入文件</button>
          <button onClick={() => { clearStickCalibration(); setGroups({}); setRunning(false); setSamples([]); setStatus("已恢复默认鼓棒位置"); }} className="flex items-center justify-center gap-1 border border-[var(--taiko-line)] px-3 py-2 text-xs"><RotateCcw size={14}/>恢复默认</button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void importFile(e.target.files?.[0])} />
        </div>
      </aside>
    </div>
  );
}

function Status({ ok, label, waiting = "未连接" }: { ok: boolean; label: string; waiting?: string }) {
  return <div className="border border-[var(--taiko-line)] p-2"><div className={ok ? "text-emerald-300" : "text-amber-300"}>{ok ? "已连接" : waiting}</div><div className="mt-1 text-[10px] text-[var(--taiko-ink)]/45">{label}</div></div>;
}
