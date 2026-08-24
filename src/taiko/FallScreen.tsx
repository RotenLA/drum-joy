import { useEffect, useMemo, useRef, useState } from "react";
import type { TaikoChart } from "@/shared/taikoChart";
import { PART_BY_NOTE, zonesFor, type LayoutMode } from "./laneLayouts";
import { renderStage } from "./stageRenderer";

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
const FLASH_MS = 200;

export function FallScreen({
  chart,
  layout,
  speed,
  onLayoutChange,
  onSpeedChange,
}: {
  chart: TaikoChart;
  layout: LayoutMode;
  speed: number;
  onLayoutChange: (m: LayoutMode) => void;
  onSpeedChange: (s: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const timeRef = useRef(0);
  /** partId -> 闪光截止时间戳 */
  const flashesRef = useRef<Record<string, number>>({});

  const zones = useMemo(() => zonesFor(layout), [layout]);

  // 键盘模拟击打：点亮该分区包含的全部鼓盘（真实 MIDI 判定下一轮接入）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const z = zones.find((z) => z.key === e.key.toLowerCase());
      if (!z) return;
      const until = performance.now() + FLASH_MS;
      for (const p of z.parts) flashesRef.current[p] = until;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zones]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = (now: number) => {
      const dt = now - last;
      last = now;
      const prev = timeRef.current;
      const t = playing ? (prev + dt) % chart.durationMs : prev;

      // 自动演奏：音符到达鼓盘时点亮对应鼓盘（未接判定前的观感验证）
      if (playing) {
        for (const n of chart.notes) {
          if (n.note === undefined) continue;
          const crossed =
            t >= prev
              ? n.timeMs > prev && n.timeMs <= t
              : n.timeMs > prev || n.timeMs <= t; // 循环回卷
          if (crossed) {
            const part = PART_BY_NOTE[n.note];
            if (part) flashesRef.current[part] = now + FLASH_MS;
          }
        }
      }
      timeRef.current = t;

      const passed = chart.notes.filter((n) => n.timeMs <= t).length;
      renderStage(ctx, canvas.clientWidth, canvas.clientHeight, {
        chart,
        timeMs: t,
        speed,
        now,
        flashes: flashesRef.current,
        combo: passed,
        score: passed * 120,
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [chart, playing, speed]);

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={wrapRef}
        className="w-full overflow-hidden border border-[var(--taiko-line)]"
        style={{
          height: "min(64vh, 660px)",
          minHeight: 420,
          backgroundColor: "#0a0a0c",
        }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="border border-[var(--taiko-ink)] px-5 py-2 text-sm tracking-wide text-[var(--taiko-ink)] transition-colors hover:bg-[var(--taiko-ink)] hover:text-[var(--taiko-paper)]"
        >
          {playing ? "暂停" : "播放"}
        </button>
        <button
          onClick={() => {
            timeRef.current = 0;
          }}
          className="border border-[var(--taiko-line)] px-5 py-2 text-sm tracking-wide text-[var(--taiko-ink)]/70 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
        >
          回到开头
        </button>

        <span className="mx-2 h-5 w-px bg-[var(--taiko-line)]" />
        <span className="text-xs text-[var(--taiko-ink)]/50">速度</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            className={`-ml-px border border-[var(--taiko-line)] px-3 py-1.5 text-xs tabular-nums transition-colors first:ml-0 ${
              speed === s
                ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
            }`}
          >
            {s}x
          </button>
        ))}

        <span className="mx-2 h-5 w-px bg-[var(--taiko-line)]" />
        <span className="text-xs text-[var(--taiko-ink)]/50">分区</span>
        {(
          [
            ["five", "5分区"],
            ["nine", "9分区"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => onLayoutChange(mode)}
            className={`-ml-px border border-[var(--taiko-line)] px-3 py-1.5 text-xs transition-colors first:ml-0 ${
              layout === mode
                ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
            }`}
          >
            {label}
          </button>
        ))}

        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--taiko-ink)]/55">
          {zones.map((z) => (
            <span key={z.id} className="flex items-center gap-1.5">
              <kbd className="border border-[var(--taiko-line)] px-1.5 py-0.5 font-mono text-[10px]">
                {z.keyLabel}
              </kbd>
              <i
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: z.color }}
              />
              {z.label}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
