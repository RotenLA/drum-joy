import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, RotateCcw, SkipForward, Upload } from "lucide-react";
import { PART_BY_ID, partOfNote } from "./laneLayouts";
import { midiManager } from "./midiInput";
import { renderPadArray } from "./stageRenderer";
import { stickManager } from "./stickInput";
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
const ORDER = CAPTURE_PARTS.flatMap((part) => [
  { part, side: "l" as StickSide },
  { part, side: "r" as StickSide },
]);
const NEED = 3;
/** 同一鼓面这个时间内的重复音符按一次处理 */
const DEDUPE_MS = 60;

interface CaptureState {
  /** ORDER 下标；-1 表示未在采集 */
  step: number;
  samples: StickSample[];
}

const IDLE: CaptureState = { step: -1, samples: [] };

export function PositionCaptureScreen() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastHitRef = useRef<{ part: CapturePart | null; at: number }>({ part: null, at: 0 });

  const [groups, setGroups] = useState<CaptureGroups>(() => loadStickCalibration()?.groups ?? {});
  const [capture, setCapture] = useState<CaptureState>(IDLE);
  const [online, setOnline] = useState<{ l: boolean; r: boolean }>({ l: false, r: false });
  const [midiSeen, setMidiSeen] = useState(false);
  const [status, setStatus] = useState("连接鼓棒姿态和 MIDI 后开始");

  const stepRef = useRef(-1);
  stepRef.current = capture.step;

  const running = capture.step >= 0;
  const current = running ? ORDER[capture.step] ?? null : null;
  const completed = ORDER.filter(({ part, side }) => Boolean(groups[part]?.[side])).length;
  const done = completed === ORDER.length && !running;

  useEffect(() => {
    const timer = window.setInterval(() => {
      const snap = stickManager.latest();
      setOnline({ l: Boolean(snap?.l), r: Boolean(snap?.r) });
    }, 120);
    return () => window.clearInterval(timer);
  }, []);

  // 单一状态机：所有推进都基于上一次的状态计算，不使用延时回调
  useEffect(() => {
    const off = midiManager.onNote((note) => {
      setMidiSeen(true);
      if (stepRef.current < 0) return;
      const actual = partOfNote(note);
      const now = performance.now();

      setCapture((prev) => {
        if (prev.step < 0) return prev;
        const target = ORDER[prev.step];
        if (!target) return prev;

        if (!actual) {
          setStatus(`音符 ${note} 尚未映射到鼓件`);
          return prev;
        }
        if (actual !== target.part) {
          setStatus(`收到${PART_BY_ID[actual].label}，请敲高亮的${PART_BY_ID[target.part].label}`);
          return prev;
        }
        const last = lastHitRef.current;
        if (last.part === actual && now - last.at < DEDUPE_MS) return prev;
        lastHitRef.current = { part: actual as CapturePart, at: now };

        const pose = stickManager.latest()?.[target.side] ?? null;
        if (!pose) {
          setStatus(`${SIDE_LABEL[target.side]}姿态未收到，请确认该棒已连接后重敲`);
          return prev;
        }

        const samples = [...prev.samples, { ...pose, at: now }];
        if (samples.length < NEED) {
          setStatus(`已捕捉 ${samples.length}/${NEED}`);
          return { step: prev.step, samples };
        }

        const summary = summarizeSamples(samples);
        setGroups((old) => ({
          ...old,
          [target.part]: { ...old[target.part], [target.side]: summary },
        }));
        const nextStep = prev.step + 1;
        if (nextStep >= ORDER.length) {
          setStatus("全部位置已捕捉，请检查结果并保存");
          return IDLE;
        }
        const item = ORDER[nextStep]!;
        setStatus(`请用${SIDE_LABEL[item.side]}敲${PART_BY_ID[item.part].label}，共 ${NEED} 次`);
        return { step: nextStep, samples: [] };
      });
    });
    return off;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
        parts: CAPTURE_PARTS,
        flashes: {},
        now,
        selected: stepRef.current >= 0 ? ORDER[stepRef.current]?.part ?? null : null,
        sticks: stickManager.latest(),
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const goTo = (index: number, note?: string) => {
    const step = ((index % ORDER.length) + ORDER.length) % ORDER.length;
    const item = ORDER[step]!;
    setCapture({ step, samples: [] });
    setStatus(
      `${note ?? ""}请用${SIDE_LABEL[item.side]}敲${PART_BY_ID[item.part].label}，共 ${NEED} 次`,
    );
  };

  const begin = () => {
    const firstMissing = ORDER.findIndex(({ part, side }) => !groups[part]?.[side]);
    goTo(firstMissing < 0 ? 0 : firstMissing);
  };
  const retest = (part: CapturePart, side: StickSide) => {
    const index = ORDER.findIndex((item) => item.part === part && item.side === side);
    setGroups((old) => ({ ...old, [part]: { ...old[part], [side]: undefined } }));
    goTo(index, "重新测试：");
  };
  const resetCurrent = () => {
    if (!running) return;
    setCapture((prev) => ({ step: prev.step, samples: [] }));
    setStatus("本项已清空，重新采集");
  };

  const calibration = useMemo(() => makeCalibration(groups), [groups]);
  const save = () => {
    saveStickCalibration(calibration);
    setStatus("校准已保存并应用到鼓棒位置");
  };
  const download = () => {
    const file = makeCalibration(groups);
    saveStickCalibration(file);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `pd2u-stick-calibration-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed: StickCalibrationFile | null = validateCalibration(JSON.parse(await file.text()));
      if (!parsed) throw new Error("invalid");
      saveStickCalibration(parsed);
      setGroups(parsed.groups);
      setCapture(IDLE);
      setStatus("校准文件已导入并应用");
    } catch {
      setStatus("校准文件无效或鼓阵版本不匹配");
    }
  };

  return (
    <div className="grid min-h-full gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div
        ref={wrapRef}
        className="relative min-h-[320px] overflow-hidden border border-[var(--taiko-line)] bg-[var(--taiko-paper)] lg:min-h-[540px]"
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
        <div className="absolute left-4 top-4 border border-[var(--taiko-line)] bg-[var(--taiko-paper)]/90 px-3 py-2 backdrop-blur">
          {current ? (
            <div className="flex items-baseline gap-2">
              <span className="text-base font-medium text-[var(--taiko-ink)]">
                {PART_BY_ID[current.part].label} · {SIDE_LABEL[current.side]}
              </span>
              <span className="text-base tabular-nums text-[var(--taiko-accent)]">
                {capture.samples.length}/{NEED}
              </span>
            </div>
          ) : (
            <div className="text-base font-medium text-[var(--taiko-ink)]">位置捕捉</div>
          )}
          <div className="mt-1 max-w-[42ch] text-xs text-[var(--taiko-ink)]/65">{status}</div>
        </div>
      </div>
      <aside className="flex min-w-0 flex-col gap-4">
        <section className="border border-[var(--taiko-line)] bg-[var(--taiko-surface)] p-4">
          <h2 className="text-sm font-medium">采集状态</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Status ok={online.l} label="左棒姿态" />
            <Status ok={online.r} label="右棒姿态" />
            <Status ok={midiSeen} label="MIDI 击打" waiting="等待击打" />
          </div>
          <div className="mt-4 h-1.5 overflow-hidden bg-[var(--taiko-ink)]/15">
            <div
              className="h-full bg-[var(--taiko-accent)] transition-all"
              style={{ width: `${(completed / ORDER.length) * 100}%` }}
            />
          </div>
          <div className="mt-2 text-xs tabular-nums text-[var(--taiko-ink)]/55">
            {completed}/{ORDER.length} 组 · 每组 {NEED} 次
          </div>
          <button
            onClick={begin}
            className="mt-4 w-full border border-[var(--taiko-ink)] px-4 py-2 text-sm"
          >
            {running ? "重新定位到未完成项" : completed ? "继续未完成项目" : "开始位置捕捉"}
          </button>
          <div className="mt-2 grid grid-cols-4 gap-1">
            <IconBtn onClick={() => goTo(capture.step - 1)} disabled={!running} title="上一项">
              <ChevronLeft size={14} />
            </IconBtn>
            <IconBtn onClick={() => goTo(capture.step + 1)} disabled={!running} title="下一项">
              <ChevronRight size={14} />
            </IconBtn>
            <IconBtn onClick={() => goTo(capture.step + 1, "已跳过：")} disabled={!running} title="跳过本项">
              <SkipForward size={14} />
            </IconBtn>
            <IconBtn onClick={resetCurrent} disabled={!running} title="重置本项">
              <RotateCcw size={14} />
            </IconBtn>
          </div>
        </section>
        <section className="max-h-[320px] overflow-auto border border-[var(--taiko-line)] bg-[var(--taiko-surface)] p-3">
          {CAPTURE_PARTS.map((part) => (
            <div
              key={part}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-[var(--taiko-line)] py-2 last:border-0"
            >
              <span className="truncate text-xs">{PART_BY_ID[part].label}</span>
              {(["l", "r"] as const).map((side) => {
                const g = groups[part]?.[side];
                const active = current?.part === part && current?.side === side;
                return (
                  <button
                    key={side}
                    onClick={() => retest(part, side)}
                    className={`min-w-16 border px-2 py-1 text-[10px] ${active ? "border-[var(--taiko-accent)] text-[var(--taiko-accent)]" : g ? (g.spread > 6 ? "border-amber-400 text-amber-300" : "border-emerald-400/50 text-emerald-300") : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/45"}`}
                  >
                    {SIDE_LABEL[side]} {g ? `${g.spread.toFixed(1)}°` : "未采"}
                  </button>
                );
              })}
            </div>
          ))}
        </section>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={save}
            disabled={!done}
            className="border border-[var(--taiko-ink)] px-3 py-2 text-xs disabled:opacity-30"
          >
            保存并应用
          </button>
          <button
            onClick={download}
            disabled={completed === 0}
            className="flex items-center justify-center gap-1 border border-[var(--taiko-line)] px-3 py-2 text-xs disabled:opacity-30"
          >
            <Download size={14} />
            导出文件
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center justify-center gap-1 border border-[var(--taiko-line)] px-3 py-2 text-xs"
          >
            <Upload size={14} />
            导入文件
          </button>
          <button
            onClick={() => {
              clearStickCalibration();
              setGroups({});
              setCapture(IDLE);
              setStatus("已恢复默认鼓棒位置");
            }}
            className="flex items-center justify-center gap-1 border border-[var(--taiko-line)] px-3 py-2 text-xs"
          >
            <RotateCcw size={14} />
            恢复默认
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
        </div>
      </aside>
    </div>
  );
}

function IconBtn({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="flex items-center justify-center border border-[var(--taiko-line)] py-1.5 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Status({ ok, label, waiting = "未连接" }: { ok: boolean; label: string; waiting?: string }) {
  return (
    <div className="border border-[var(--taiko-line)] p-2">
      <div className={ok ? "text-emerald-300" : "text-amber-300"}>{ok ? "已连接" : waiting}</div>
      <div className="mt-1 text-[10px] text-[var(--taiko-ink)]/45">{label}</div>
    </div>
  );
}
