import { useEffect, useRef, useState } from "react";
import {
  DRUM_PARTS,
  PART_BY_ID,
  getMapping,
  partOfNote,
  resetMapping,
  setMapping,
  type DrumMapping,
  type PartId,
} from "./laneLayouts";
import { partAtPoint, renderPadArray } from "./stageRenderer";
import { midiManager, type MidiInputInfo } from "./midiInput";
import { getDrumNoteName } from "@/shared/drumLaneMap";
import { HelpDot } from "@/components/HelpDot";
import { helpText } from "./helpTexts";
import { useLanguage } from "./i18n";

const ALL_PARTS = DRUM_PARTS.map((p) => p.id);

/**
 * 映射屏：游玩屏同款扇形鼓阵，点击鼓盘编辑该部件的 MIDI 音符映射；
 * 顶部选择 MIDI 输入设备；支持 MIDI Learn（选中鼓盘后敲实体鼓即录入）。
 */
export function MappingScreen({
  deviceId,
  onDeviceChange,
}: {
  deviceId: string | null;
  onDeviceChange: (id: string | null) => void;
}) {
  const { tr, language } = useLanguage();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const flashesRef = useRef<Record<string, number>>({});
  const [mappingState, setMappingState] = useState<DrumMapping>(getMapping());
  const [selected, setSelected] = useState<PartId | null>(null);
  const [learning, setLearning] = useState(false);
  const [devices, setDevices] = useState<MidiInputInfo[]>([]);
  const [midiReady, setMidiReady] = useState<boolean | null>(null);
  const [lastNote, setLastNote] = useState<number | null>(null);
  const [noteInput, setNoteInput] = useState("");

  const selectedRef = useRef<PartId | null>(null);
  const learningRef = useRef(false);
  selectedRef.current = selected;
  learningRef.current = learning;

  const apply = (m: DrumMapping) => {
    setMapping(m);
    setMappingState({ ...m });
  };

  const addNote = (part: PartId, note: number) => {
    if (!Number.isInteger(note) || note < 0 || note > 127) return;
    const m = { ...getMapping() } as Record<PartId, number[]>;
    for (const p of ALL_PARTS) m[p] = [...(m[p] ?? [])].filter((n) => n !== note);
    m[part] = [...(m[part] ?? []), note].sort((a, b) => a - b);
    apply(m as DrumMapping);
  };

  const removeNote = (part: PartId, note: number) => {
    const m = { ...getMapping() } as Record<PartId, number[]>;
    m[part] = (m[part] ?? []).filter((n) => n !== note);
    apply(m as DrumMapping);
  };

  // ---- MIDI：初始化 + 设备列表 + note 订阅（闪光 / Learn / 最近音符） ----
  useEffect(() => {
    let mounted = true;
    void midiManager.init().then((ok) => {
      if (!mounted) return;
      setMidiReady(ok);
      setDevices(midiManager.inputs());
    });
    const unsubState = midiManager.onState(() => setDevices(midiManager.inputs()));
    const unsubNote = midiManager.onNote((note) => {
      setLastNote(note);
      const part = partOfNote(note);
      if (part) flashesRef.current[part] = performance.now() + 200;
      // MIDI Learn：捕获到的音符直接加入选中部件（从其他部件移除），学一次即停
      if (learningRef.current && selectedRef.current) {
        addNote(selectedRef.current, note);
        setLearning(false);
      }
    });
    return () => {
      mounted = false;
      unsubState();
      unsubNote();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 设备选择生效
  useEffect(() => {
    void midiManager.init().then(() => midiManager.select(deviceId));
  }, [deviceId]);

  // ---- 鼓阵渲染循环 ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = wrap.clientWidth * dpr;
      canvas.height = wrap.clientHeight * dpr;
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = (now: number) => {
      renderPadArray(ctx, canvas.clientWidth, canvas.clientHeight, {
        parts: ALL_PARTS,
        flashes: flashesRef.current,
        now,
        selected: selectedRef.current,
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const part = partAtPoint(
      ALL_PARTS,
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
      rect.height,
    );
    setSelected(part);
    setLearning(false);
  };

  const sel = selected ? PART_BY_ID[selected] : null;

  return (
    <div className="flex flex-col gap-4">
      {/* MIDI 设备 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-[var(--taiko-line)] px-4 py-3">
        <span className="flex items-center gap-1 text-xs text-[var(--taiko-ink)]/60">
          {tr("MIDI 输入设备", "MIDI input device")}
          <HelpDot label={tr("MIDI 输入设备", "MIDI input device")} text={helpText("midiDevice", language)} />
        </span>
        {midiReady === false ? (
          <span className="text-xs text-[var(--taiko-ink)]/45">
            {tr(
              "当前环境不支持 Web MIDI（请在 Chrome / Electron 中使用）",
              "Web MIDI isn't supported here (use Chrome or Electron)",
            )}
          </span>
        ) : (
          <select
            value={deviceId ?? ""}
            onChange={(e) => onDeviceChange(e.target.value || null)}
            className="border border-[var(--taiko-line)] bg-[var(--taiko-surface)] px-2 py-1 text-sm text-[var(--taiko-ink)]"
          >
            <option value="" className="bg-[var(--taiko-surface)] text-[var(--taiko-ink)]">
              {tr("全部输入（未指定）", "All inputs (unspecified)")}
            </option>
            {devices.map((d) => (
              <option
                key={d.id}
                value={d.id}
                className="bg-[var(--taiko-surface)] text-[var(--taiko-ink)]"
              >
                {d.name}
              </option>
            ))}
          </select>
        )}
        <span className="text-xs tabular-nums text-[var(--taiko-ink)]/45">
          {lastNote !== null
            ? tr(
                `最近收到音符：${lastNote}（${getDrumNoteName(lastNote)}）`,
                `Last note received: ${lastNote} (${getDrumNoteName(lastNote)})`,
              )
            : tr("等待 MIDI 输入…", "Waiting for MIDI input…")}
        </span>
        <button
          onClick={() => {
            apply(resetMapping());
            setLearning(false);
          }}
          className="ml-auto border border-[var(--taiko-line)] px-3 py-1.5 text-xs text-[var(--taiko-ink)]/70 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
        >
          {tr("恢复默认映射", "Reset to defaults")}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* 鼓阵（与游玩屏同款摆位/绘制） */}
        <div
          ref={wrapRef}
          className="w-full overflow-hidden border border-[var(--taiko-line)]"
          style={{ aspectRatio: "14 / 5", backgroundColor: "var(--taiko-paper)" }}
        >
          <canvas
            ref={canvasRef}
            className="block h-full w-full cursor-pointer"
            onClick={onCanvasClick}
          />
        </div>

        {/* 选中部件编辑面板 */}
        <aside className="flex h-fit flex-col gap-3 border border-[var(--taiko-line)] p-4">
          {sel && selected ? (
            <>
              <div className="flex items-center gap-2">
                <i
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: sel.color }}
                />
                <span className="text-sm font-medium">{tr(sel.label, sel.labelEn)}</span>
                <span className="ml-auto text-xs tabular-nums text-[var(--taiko-ink)]/45">
                  {tr(
                    `${mappingState[selected].length} 个音符`,
                    `${mappingState[selected].length} note${mappingState[selected].length === 1 ? "" : "s"}`,
                  )}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {mappingState[selected].length === 0 && (
                  <span className="text-xs text-[var(--taiko-ink)]/40">
                    {tr("未映射任何音符", "No notes mapped")}
                  </span>
                )}
                {mappingState[selected].map((n) => (
                  <span
                    key={n}
                    className="flex items-center gap-1 border border-[var(--taiko-line)] px-2 py-0.5 text-xs tabular-nums"
                    title={getDrumNoteName(n)}
                  >
                    {n}
                    <button
                      onClick={() => removeNote(selected, n)}
                      className="text-[var(--taiko-ink)]/40 hover:text-[var(--taiko-ink)]"
                      aria-label={tr(`移除音符 ${n}`, `Remove note ${n}`)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder={tr("音符号 0-127", "Note 0-127")}
                  className="w-full border border-[var(--taiko-line)] bg-transparent px-2 py-1 text-sm tabular-nums text-[var(--taiko-ink)]"
                />
                <button
                  onClick={() => {
                    const v = Number(noteInput);
                    if (Number.isInteger(v)) {
                      addNote(selected, v);
                      setNoteInput("");
                    }
                  }}
                  className="shrink-0 border border-[var(--taiko-ink)] px-3 py-1 text-xs text-[var(--taiko-ink)] transition-colors hover:bg-[var(--taiko-ink)] hover:text-[var(--taiko-paper)]"
                >
                  {tr("添加", "Add")}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLearning((v) => !v)}
                  className={`border px-3 py-2 text-xs transition-colors ${
                    learning
                      ? "animate-pulse border-[var(--taiko-accent)] bg-[var(--taiko-accent)] text-[var(--taiko-paper)]"
                      : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/70 hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
                  }`}
                >
                  {learning
                    ? tr("敲一下实体鼓…（点击取消）", "Hit the drum now… (click to cancel)")
                    : "MIDI Learn"}
                </button>
                <HelpDot label="MIDI Learn" text={helpText("mapping", language)} />
              </div>

              <p className="text-xs leading-relaxed text-[var(--taiko-ink)]/45">
                {tr(
                  "音符会同时从其他部件移除（一个音符只归属一个部件）。游玩屏判定与键盘图例即时生效。",
                  "The note is removed from other pieces (each note belongs to only one piece). Play-screen judging and the keyboard legend update instantly.",
                )}
              </p>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-[var(--taiko-ink)]/45">
              {tr(
                "点击左侧鼓盘，编辑该部件映射的 MIDI 音符。敲鼓时对应鼓盘会闪光，可用来验证接线与映射。",
                "Click a pad on the left to edit its mapped MIDI notes. Hitting a drum flashes the matching pad, handy for checking wiring and mapping.",
              )}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
