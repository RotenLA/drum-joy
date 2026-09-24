/**
 * 教学练习谱：按当前步骤的目标鼓件生成一段循环练习谱面，
 * 交给正式渲染器（stageRenderer.renderStage）绘制，
 * 因此教学里的鼓面摆位、车道、飞行时间、缩圈提示与正式游戏完全一致。
 */
import type { TaikoChart, TaikoNote } from "@/shared/taikoChart";
import { getMapping, type PartId } from "../laneLayouts";
import type { TutorialStep } from "./steps";

/** 教学固定 100 BPM 4/4 */
export const PRACTICE_BPM = 100;
const BEAT_MS = 60000 / PRACTICE_BPM;
/** 预热拍数（与正式游戏的倒计时观感一致） */
const LEAD_BEATS = 4;
/** 长踩音符时长：8 拍 = 4800ms，与判定用的 4800ms 超时一致 */
export const HOLD_MS = BEAT_MS * 8;
/** 循环次数（够长即可，避免练习中途谱面结束） */
const LOOPS = 40;

function noteOf(part: PartId): number {
  return getMapping()[part][0] ?? 38;
}

function laneOf(note: number): TaikoNote["lane"] {
  return note === 36 || note === 44 ? "don" : "ka";
}

function push(notes: TaikoNote[], part: PartId, timeMs: number, holdMs?: number) {
  const note = noteOf(part);
  notes.push({ timeMs, lane: laneOf(note), note, ...(holdMs ? { holdMs } : {}) });
}

/**
 * 生成练习谱：
 * - short / combo：目标鼓件每 2 拍轮流落一个短音符；
 *   组合里若同时含左踏板（pedalHat）与手部鼓件，
 *   每个手部音符的同一时刻都会配一个左踏板短音符——
 *   两者并排同时到达判定线，要求同时敲击（不再用长音符表现「保持踩住」）。
 * - hold：左踏板长音符，每 12 拍一次（仅「踩住长音符」专属课）。
 * - parts / done：无音符（只显示鼓阵）。
 */
export function buildPracticeChart(step: TutorialStep, title: string): TaikoChart {
  const notes: TaikoNote[] = [];
  const targets = step.targets ?? [];
  const lead = LEAD_BEATS * BEAT_MS;

  if (step.kind === "hold") {
    const cycle = BEAT_MS * 12;
    for (let i = 0; i < LOOPS; i++) push(notes, "pedalHat", lead + i * cycle, HOLD_MS);
  } else if (targets.length > 0) {
    const hand = targets.filter((p) => p !== "pedalHat");
    const syncPedal = targets.includes("pedalHat") && hand.length > 0;
    const step2 = BEAT_MS * 2;
    const per = Math.max(1, hand.length ? hand.length : targets.length);
    const seq: readonly PartId[] = hand.length ? hand : targets;
    const total = LOOPS * per * 2;
    for (let i = 0; i < total; i++) {
      const t = lead + i * step2;
      push(notes, seq[i % seq.length]!, t);
      // 同一时刻补一个左踏板短音符，与手部音符同时触发
      if (syncPedal) push(notes, "pedalHat", t);
    }
  }

  const last = notes.reduce((m, n) => Math.max(m, n.timeMs + (n.holdMs ?? 0)), 0);
  return {
    title,
    bpm: PRACTICE_BPM,
    timeSignature: [4, 4],
    durationMs: Math.max(last + BEAT_MS * 4, BEAT_MS * 16),
    notes,
  };
}
