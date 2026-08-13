import { useEffect, useRef, useState } from "react";
import type { TaikoChart } from "@/shared/taikoChart";

const HIT_X = 140;
const PIXELS_PER_MS = 0.32;

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function PlayScreen({ chart }: { chart: TaikoChart }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const [combo, setCombo] = useState(0);
  const [progress, setProgress] = useState(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const colors = {
      ink: cssVar("--taiko-ink", "#1f1d1a"),
      line: cssVar("--taiko-line", "#c9c3b7"),
      surface: cssVar("--taiko-surface", "#e8e4dd"),
      don: cssVar("--taiko-don", "#d9463e"),
      ka: cssVar("--taiko-ka", "#2f6fb0"),
      paper: cssVar("--taiko-paper", "#f5f3ee"),
    };

    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = 200;
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
      if (playing) {
        timeRef.current = (timeRef.current + dt) % chart.durationMs;
      }
      const t = timeRef.current;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const mid = h / 2;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colors.paper;
      ctx.fillRect(0, 0, w, h);

      // 轨道
      ctx.fillStyle = colors.surface;
      ctx.fillRect(0, mid - 46, w, 92);
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid - 46.5);
      ctx.lineTo(w, mid - 46.5);
      ctx.moveTo(0, mid + 46.5);
      ctx.lineTo(w, mid + 46.5);
      ctx.stroke();

      // 判定圈
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(HIT_X, mid, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(HIT_X, mid, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 音符
      for (const note of chart.notes) {
        const x = HIT_X + (note.timeMs - t) * PIXELS_PER_MS;
        if (x < -60 || x > w + 60) continue;
        const r = note.big ? 30 : 20;
        ctx.fillStyle = note.lane === "don" ? colors.don : colors.ka;
        ctx.beginPath();
        ctx.arc(x, mid, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = colors.ink;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      setProgress(t / chart.durationMs);
      setCombo(chart.notes.filter((n) => n.timeMs <= t).length);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [chart, playing]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between border-b border-[var(--taiko-line)] pb-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--taiko-ink)]/50">
            连击
          </div>
          <div className="text-5xl font-semibold tabular-nums text-[var(--taiko-ink)]">
            {combo}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--taiko-ink)]/50">
            进度
          </div>
          <div className="text-2xl tabular-nums text-[var(--taiko-ink)]">
            {Math.round(progress * 100)}%
          </div>
        </div>
      </div>

      <div ref={wrapRef} className="w-full">
        <canvas ref={canvasRef} className="block w-full" />
      </div>

      <div className="h-[2px] w-full bg-[var(--taiko-line)]">
        <div
          className="h-full bg-[var(--taiko-ink)]"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="flex items-center gap-3">
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
        <span className="ml-auto flex items-center gap-4 text-xs text-[var(--taiko-ink)]/60">
          <span className="flex items-center gap-2">
            <i className="inline-block h-3 w-3 rounded-full bg-[var(--taiko-don)]" /> 咚（双脚）
          </span>
          <span className="flex items-center gap-2">
            <i className="inline-block h-3 w-3 rounded-full bg-[var(--taiko-ka)]" /> 嗒（双手）
          </span>
        </span>
      </div>
    </div>
  );
}
