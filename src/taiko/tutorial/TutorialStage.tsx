/**
 * 教学用小舞台：与游玩屏同一套渲染（stageRenderer），只显示五个部件。
 * mode = "demo"     自动演示，音符到点自动闪光，不需要玩家输入
 * mode = "practice" 玩家跟着节拍器敲，连续完成 TARGET 次即通过
 */
import { useEffect, useRef, useState } from "react";
import { renderStage } from "../stageRenderer";
import { quality } from "../perf";
import { partOfNote, type PartId } from "../laneLayouts";
import { midiManager } from "../midiInput";
import { click as metronomeClick, getAudioContext } from "../metronome";
import { loadKitEnabled, playDrum, subscribeKitEnabled } from "../drumKit";
import { loadCalibration } from "../calibration";
import {
  BEAT_MS,
  TARGET,
  TUTORIAL_PARTS,
  WARMUP_BEATS,
  buildLessonChart,
  type Lesson,
} from "./steps";

const HIT_WINDOW = 200;
const PERFECT_WINDOW = 100;
const FLASH_MS = 200;
const BARS = 24;

export function TutorialStage({
  lesson,
  mode,
  onPass,
  restartKey,
}: {
  lesson: Lesson;
  mode: "demo" | "practice";
  onPass?: () => void;
  restartKey: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(0);
  const [progress, setProgress] = useState(0);
  const [tip, setTip] = useState("");
  // 鼓音色开关与谱面页共用同一份状态，切换后立即生效
  const kitOnRef = useRef(true);
  useEffect(() => {
    kitOnRef.current = loadKitEnabled();
    return subscribeKitEnabled((on) => {
      kitOnRef.current = on;
    });
  }, []);


  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    let passed = false;
    progressRef.current = 0;
    setProgress(0);
    setTip("");

    const chart = buildLessonChart(lesson, BARS);
    const notes = chart.notes;
    const judged = new Uint8Array(notes.length);
    const flashes: Record<string, number> = {};
    const missFlashes: Record<string, number> = {};
    const calib = loadCalibration();

    const holdPart = lesson.hold?.part ?? null;
    /** 组合课：踩住左踏板的同时还要敲够次数 */
    const holdNeedsHits = Boolean(lesson.hold && lesson.pattern.length > 0);

    const audio = getAudioContext();
    const startSec = audio.currentTime + 0.4;
    const clockMs = () => (audio.currentTime - startSec) * 1000;

    let streak = 0;
    let pedalHeld = false;
    let holdActiveOk = false;
    let judgement: { text: string; color: string; until: number } | null = null;

    // 节拍器：150ms 前瞻调度，与音符共用同一条音频时间轴
    let nextBeat = 0;
    const totalBeats = WARMUP_BEATS + BARS * 4;
    const schedule = window.setInterval(() => {
      const ahead = audio.currentTime + 0.15;
      while (nextBeat < totalBeats && startSec + (nextBeat * BEAT_MS) / 1000 < ahead) {
        metronomeClick(nextBeat % 4 === 0, startSec + (nextBeat * BEAT_MS) / 1000);
        nextBeat++;
      }
    }, 40);

    const setStreak = (v: number) => {
      streak = v;
      progressRef.current = v;
      setProgress(v);
    };

    const pass = () => {
      if (passed) return;
      passed = true;
      setStreak(TARGET);
      window.setTimeout(() => onPass?.(), 600);
    };

    const bump = (ok: boolean) => {
      if (passed || mode !== "practice") return;
      if (!ok) {
        setStreak(0);
        return;
      }
      setStreak(streak + 1);
      if (streak >= TARGET) pass();
    };

    /** 玩家敲击：找最近的未判定同部件短音符 */
    const hit = (part: PartId, atMs: number, vel: number) => {
      const now = performance.now();
      if (kitOnRef.current) playDrum(part, vel);
      flashes[part] = now + FLASH_MS;
      if (mode !== "practice" || passed) return;
      if (holdPart && part === holdPart) {
        pedalHeld = true;
        return;
      }
      if (holdNeedsHits && !pedalHeld) {
        setTip("先用左脚踩住左踏板，再敲踩镲");
        return;
      }
      const t = clockMs() - (now - atMs) + calib.judgeMs;
      let best = -1;
      let bestDiff = HIT_WINDOW;
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i]!;
        if (n.timeMs - t > HIT_WINDOW) break;
        if (judged[i] || (n.holdMs ?? 0) > 0) continue;
        if (n.note === undefined || partOfNote(n.note) !== part) continue;
        const d = Math.abs(n.timeMs - t);
        if (d < bestDiff) {
          bestDiff = d;
          best = i;
        }
      }
      if (best < 0) return;
      judged[best] = 1;
      judgement = {
        text: bestDiff <= PERFECT_WINDOW ? "PERFECT" : "GOOD",
        color: bestDiff <= PERFECT_WINDOW ? "#ffd75e" : "#7dd3fc",
        until: now + 450,
      };
      setTip("");
      bump(true);
    };

    void midiManager.init();
    const offNote = midiManager.onNote((note, vel, atMs) => {
      const part = partOfNote(note);
      if (!part || !TUTORIAL_PARTS.includes(part)) return;
      hit(part, atMs, vel);
    });
    const offUp = midiManager.onNoteOff((note) => {
      if (holdPart && partOfNote(note) === holdPart) pedalHeld = false;
    });

    let raf = 0;
    let last = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, quality.params.maxDpr);
      canvas.width = wrap.clientWidth * dpr;
      canvas.height = wrap.clientHeight * dpr;
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = last ? now - last : 0;
      if (dt && dt < 1000 / quality.params.maxFps - 2) return;
      last = now;
      const t = clockMs();

      if (mode === "demo") {
        for (let i = 0; i < notes.length; i++) {
          if (judged[i]) continue;
          const n = notes[i]!;
          if (t < n.timeMs) break;
          judged[i] = 1;
          const p = n.note !== undefined ? partOfNote(n.note) : null;
          if (p) flashes[p] = now + FLASH_MS + (n.holdMs ?? 0);
        }
      } else {
        // 短音符过窗未击 → 连击清零
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i]!;
          if (n.timeMs >= t - HIT_WINDOW) break;
          if (judged[i] || (n.holdMs ?? 0) > 0) continue;
          judged[i] = 2;
          const p = n.note !== undefined ? partOfNote(n.note) : null;
          if (p) missFlashes[p] = now + 240;
          judgement = { text: "MISS", color: "#f87171", until: now + 450 };
          if (!holdNeedsHits) bump(false);
        }
        // 长音符：整段按住不能松
        if (holdPart) {
          for (let i = 0; i < notes.length; i++) {
            const n = notes[i]!;
            const len = n.holdMs ?? 0;
            if (len <= 0 || judged[i]) continue;
            const end = n.timeMs + len;
            if (t < n.timeMs || t > end + HIT_WINDOW) continue;
            if (pedalHeld) {
              holdActiveOk = true;
              flashes[holdPart] = now + 120;
              if (t >= end - 40) {
                judged[i] = 1;
                if (!holdNeedsHits) pass();
              }
            } else if (holdActiveOk) {
              holdActiveOk = false;
              judged[i] = 2;
              missFlashes[holdPart] = now + 240;
              setTip("左踏板松开了，重新踩住");
              setStreak(0);
            }
          }
        }
      }

      renderStage(ctx2d, canvas.clientWidth, canvas.clientHeight, {
        chart,
        timeMs: t + calib.visualMs,
        speed: 1.2,
        now,
        flashes,
        missFlashes,
        combo: mode === "practice" ? progressRef.current : 0,
        score: 0,
        parts: TUTORIAL_PARTS,
        judgement: judgement && judgement.until > now ? judgement : null,
        countText:
          t < 0 ? String(Math.min(WARMUP_BEATS, Math.max(1, Math.ceil(-t / BEAT_MS)))) : null,
        stats: null,
        showNotes: true,
        sticks: null,
      });
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.clearInterval(schedule);
      offNote();
      offUp();
    };
    // restartKey 变化 = 重看一次 / 再练一次
  }, [lesson, mode, onPass, restartKey]);

  // 铺满外层舞台框（由 TutorialOverlay 提供尺寸），卡片叠在同一块画面上
  return (
    <>
      <div ref={wrapRef} className="absolute inset-0 overflow-hidden bg-[#0a0a0c]">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
      {mode === "practice" && (
        <div className="absolute left-3 top-3 flex items-center gap-3 border border-white/15 bg-black/45 px-3 py-1 text-xs text-white/75 backdrop-blur">
          <span className="tabular-nums">
            进度 {Math.min(progress, TARGET)} / {TARGET}
          </span>
          {tip && <span className="text-white/50">{tip}</span>}
        </div>
      )}
    </>
  );
}
