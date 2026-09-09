/**
 * 鼓 MIDI 拆解第一步：量化 → 小节相位对齐 → 降噪。
 *
 * 声源分离后转出的 MIDI 时间抖动大、碎音多、小节起点常常偏半小节，
 * 这里统一把音符吸附到 16 分网格上，得到「网格步 + 部件 + 力度」的干净事件表，
 * 后续的骨架、三档难度都基于它工作，不再直接吃原始音符。
 */
import { GM_TO_PART } from "./midiChart";
import type { PartId } from "./laneLayouts";
import { tickToMs, type ParsedMidi } from "./midiFile";

export interface CleanHit {
  /** 16 分网格序号（从 tick 0 起算） */
  step: number;
  part: PartId;
  velocity: number;
}

export interface CleanedMidi {
  hits: CleanHit[];
  /** 一个 16 分网格的 tick 数 */
  stepTicks: number;
  /** 一小节的网格数（4/4 = 16） */
  stepsPerBar: number;
  /** 一拍的网格数（固定 4） */
  stepsPerBeat: number;
  /** 小节线相位：第 1 拍落在 step ≡ phaseSteps (mod stepsPerBar) */
  phaseSteps: number;
  timeSignature: [number, number];
  bpm: number;
  ppq: number;
}

export const STEPS_PER_BEAT = 4;

/** 力度极低的孤立镲片视为误检 */
const WEAK_CYMBAL_VELOCITY = 45;

export interface CleanOptions {
  /** 手动相位微调（单位：拍，可正负） */
  phaseBeatOffset?: number;
}

export function cleanMidi(midi: ParsedMidi, opts: CleanOptions = {}): CleanedMidi {
  const ppq = midi.ppq || 480;
  const stepTicks = Math.max(1, Math.round(ppq / STEPS_PER_BEAT));
  const [num, den] = midi.timeSignature;
  const beatsPerBar = Math.max(1, Math.round(num * (4 / den)));
  const stepsPerBar = beatsPerBar * STEPS_PER_BEAT;

  // 1) 量化 + 部件归并
  const byKey = new Map<string, CleanHit>();
  for (const ev of midi.notes) {
    const part = GM_TO_PART[ev.note];
    if (!part) continue;
    const step = Math.round(ev.tick / stepTicks);
    if (step < 0) continue;
    const key = `${step}:${part}`;
    const prev = byKey.get(key);
    // 2) 降噪之一：同一格同一鼓件只留最响的一下
    if (!prev || ev.velocity > prev.velocity) byKey.set(key, { step, part, velocity: ev.velocity });
  }

  let hits = [...byKey.values()].sort((a, b) => a.step - b.step || a.part.localeCompare(b.part));

  // 3) 降噪之二：孤立的极弱镲片丢弃
  const stepSet = new Set(hits.map((h) => h.step));
  hits = hits.filter((h) => {
    if (h.part !== "crash" && h.part !== "ride") return true;
    if (h.velocity >= WEAK_CYMBAL_VELOCITY) return true;
    return stepSet.has(h.step - 1) || stepSet.has(h.step + 1);
  });

  // 4) 相位检测：找出哪个网格位是第 1 拍
  const phaseSteps = detectPhase(hits, stepsPerBar, opts.phaseBeatOffset ?? 0);

  return {
    hits,
    stepTicks,
    stepsPerBar,
    stepsPerBeat: STEPS_PER_BEAT,
    phaseSteps,
    timeSignature: midi.timeSignature,
    bpm: midi.bpm,
    ppq,
  };
}

function detectPhase(hits: CleanHit[], stepsPerBar: number, beatOffset: number): number {
  const beats = stepsPerBar / STEPS_PER_BEAT;
  let best = 0;
  let bestScore = -Infinity;
  for (let o = 0; o < stepsPerBar; o++) {
    let score = 0;
    for (const h of hits) {
      const local = ((h.step - o) % stepsPerBar + stepsPerBar) % stepsPerBar;
      const onBeat = local % STEPS_PER_BEAT === 0;
      if (!onBeat) continue;
      const beat = local / STEPS_PER_BEAT;
      if (h.part === "snare" && beat % 2 === 1) score += 2;
      if (h.part === "kick" && beat === 0) score += 1.5;
      if (h.part === "crash" && beat === 0) score += 2;
      if (h.part === "hihat") score += 0.15;
    }
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  const shifted = best + Math.round(beatOffset) * STEPS_PER_BEAT;
  const period = beats * STEPS_PER_BEAT;
  return ((shifted % period) + period) % period;
}

/** 网格步 → 毫秒（走 tempo map） */
export function stepToMs(midi: ParsedMidi, clean: CleanedMidi, step: number): number {
  return tickToMs(midi, step * clean.stepTicks);
}
