/**
 * 教学舞台：直接复用正式游戏的画布渲染器（renderStage），
 * 鼓盘摆位/大小/角度、辐射车道、音符下落与缩圈提示全部与游玩屏一致。
 */
import { useEffect, useMemo, useRef } from "react";
import { VISIBLE_PARTS, type PartId } from "../laneLayouts";
import { quality } from "../perf";
import { renderStage } from "../stageRenderer";
import { useLanguage } from "../i18n";
import { tutorialLabels, tutorialStepCopy, type TutorialStep } from "./steps";
import { buildPracticeChart } from "./practiceChart";

export function TutorialStage({
  step,
  index,
  flashes,
  progress,
  needed,
  hold,
  restartKey,
}: {
  step: TutorialStep;
  index: number;
  flashes: React.MutableRefObject<Record<string, number>>;
  progress: number;
  needed: number;
  hold: boolean;
  restartKey: number;
}) {
  const { language } = useLanguage();
  const labels = tutorialLabels(language);
  const copy = tutorialStepCopy(language, index, step);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const chart = useMemo(() => buildPracticeChart(step, copy.title), [step, copy.title]);
  const showNotes = step.kind !== "parts" && step.kind !== "done";
  // 「认识鼓件」只显示鼓阵；其余步骤仍显示全部 9 件，避免与正式游戏构图不同
  const parts = useMemo<readonly PartId[]>(() => VISIBLE_PARTS.nine, []);
  const pulseRef = useRef(0);

  // 「认识鼓件」步骤：轮流点亮各鼓件（用正式渲染器的命中高亮）
  useEffect(() => {
    if (step.kind !== "parts") return;
    const timer = window.setInterval(() => {
      const id = parts[pulseRef.current % parts.length]!;
      pulseRef.current += 1;
      flashes.current[id] = performance.now() + 420;
    }, 700);
    return () => window.clearInterval(timer);
  }, [flashes, parts, step.kind]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, quality.params.maxDpr);
      canvas.width = Math.max(1, wrap.clientWidth * dpr);
      canvas.height = Math.max(1, wrap.clientHeight * dpr);
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    if (ro) ro.observe(wrap);
    else window.addEventListener("resize", resize);

    const t0 = performance.now();
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const now = performance.now();
      const elapsed = now - t0;
      const timeMs = chart.durationMs > 0 ? elapsed % chart.durationMs : elapsed;
      renderStage(ctx, canvas.clientWidth, canvas.clientHeight, {
        chart,
        timeMs,
        speed: 1,
        now,
        flashes: flashes.current,
        combo: 0,
        score: 0,
        parts,
        showNotes,
        minimalHud: true,
        sticks: null,
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      if (!ro) window.removeEventListener("resize", resize);
    };
  }, [chart, flashes, parts, showNotes, restartKey]);

  return (
    <div ref={wrapRef} className="relative h-full min-h-[240px] w-full overflow-hidden bg-[var(--taiko-paper)]">
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="absolute bottom-3 left-3 rounded-md border border-[var(--taiko-glass-line)] bg-[rgba(8,7,9,0.72)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.84)]">
        {hold ? labels.holding : `${progress} / ${needed}`}
      </div>
    </div>
  );
}
