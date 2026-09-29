/**
 * 鼓 MIDI 拆解第一步：量化 → 小节相位对齐 → 降噪。
 *
 * 声源分离后转出的 MIDI 时间抖动大、碎音多、小节起点常常偏半小节，
 * 这里统一把音符吸附到 16 分网格上，得到「网格步 + 部件 + 力度」的干净事件表，
 * 后续的骨架、三档难度都基于它工作，不再直接吃原始音符。
 */
import { GM_TO_PART, OPEN_HAT_NOTES } from "./midiChart";
import type { PartId } from "./laneLayouts";
import { tickToMs, type ParsedMidi } from "./midiFile";

export interface CleanHit {
  /** 16 分网格序号（从 tick 0 起算） */
  step: number;
  part: PartId;
  velocity: number;
  /** 原始 MIDI 事件时间；最终谱面必须使用它，量化 step 仅供分析。 */
  timeMs: number;
  /** 踩镲为开镲（左脚松开）；其余部件恒为 false */
  open?: boolean;
}

export interface CleanedMidi {
  sourceMidi: ParsedMidi;
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
/** 底鼓 / 军鼓的噪声门限（AI 分轨常在这个力度以下吐出残响碎音） */
const WEAK_DRUM_VELOCITY = 38;
/** 同一部件的最小间隔：更近的判为同一击打的重复触发 */
const DEBOUNCE_MS = 62;
/** 单手同刻部件上限（双手） */
const MAX_HANDS_AT_ONCE = 2;
/** 同刻仲裁优先级，数字小的优先保留（串音多发的通鼓最后） */
const HAND_PRIORITY: Partial<Record<PartId, number>> = {
  snare: 0,
  crash: 1,
  hihat: 2,
  ride: 3,
  highTom: 4,
  midTom: 5,
  floorTom: 6,
};

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
    // 降噪之一：底鼓 / 军鼓的极弱事件基本是低频轰鸣或串音
    if ((part === "kick" || part === "snare") && ev.velocity < WEAK_DRUM_VELOCITY) continue;
    const step = Math.round(ev.tick / stepTicks);
    if (step < 0) continue;
    const key = `${step}:${part}`;
    const prev = byKey.get(key);
    const open = part === "hihat" && OPEN_HAT_NOTES.has(ev.note);
    // 降噪之二：同一格同一鼓件只留最响的一下（开镲标记做或运算保留）
    if (!prev || ev.velocity > prev.velocity) {
      byKey.set(key, { step, part, velocity: ev.velocity, timeMs: ev.timeMs, open: open || (prev?.open ?? false) });
    } else if (open && prev) {
      prev.open = true;
    }
  }

  let hits = [...byKey.values()].sort((a, b) => a.step - b.step || a.part.localeCompare(b.part));

  // 2) 降噪之三：孤立的极弱镲片丢弃
  const stepSet = new Set(hits.map((h) => h.step));
  hits = hits.filter((h) => {
    if (h.part !== "crash" && h.part !== "ride") return true;
    if (h.velocity >= WEAK_CYMBAL_VELOCITY) return true;
    return stepSet.has(h.step - 1) || stepSet.has(h.step + 1);
  });

  // 3) 降噪之四：同部件消抖（一次击打被 AI 吐成两下）
  hits = debounce(hits);

  // 4) 降噪之五：同刻生理仲裁，剔除频谱串音造成的多余通鼓
  hits = limitSimultaneous(hits);

  // 5) 相位检测：找出哪个网格位是第 1 拍
  const phaseSteps = detectPhase(hits, stepsPerBar, opts.phaseBeatOffset ?? 0);

  return {
    sourceMidi: midi,
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

/** 同一部件相邻击打间隔小于阈值时，只保留力度更大的一记 */
function debounce(hits: CleanHit[]): CleanHit[] {
  const byPart = new Map<PartId, CleanHit[]>();
  for (const h of hits) {
    const list = byPart.get(h.part) ?? [];
    list.push(h);
    byPart.set(h.part, list);
  }
  const drop = new Set<CleanHit>();
  for (const list of byPart.values()) {
    list.sort((a, b) => a.timeMs - b.timeMs);
    let keep = list[0];
    for (let i = 1; i < list.length; i++) {
      const cur = list[i]!;
      if (keep && cur.timeMs - keep.timeMs < DEBOUNCE_MS) {
        // 粘连的两记合并：丢掉弱的那一记
        if (cur.velocity > keep.velocity) {
          drop.add(keep);
          keep = cur;
        } else {
          drop.add(cur);
        }
      } else {
        keep = cur;
      }
    }
  }
  return hits.filter((h) => !drop.has(h));
}

/** 同一网格位上手部件超过两个时按优先级保留 */
function limitSimultaneous(hits: CleanHit[]): CleanHit[] {
  const byStep = new Map<number, CleanHit[]>();
  for (const h of hits) {
    const list = byStep.get(h.step) ?? [];
    list.push(h);
    byStep.set(h.step, list);
  }
  const drop = new Set<CleanHit>();
  for (const list of byStep.values()) {
    const hands = list.filter((h) => HAND_PRIORITY[h.part] !== undefined);
    if (hands.length <= MAX_HANDS_AT_ONCE) continue;
    hands.sort(
      (a, b) => (HAND_PRIORITY[a.part] ?? 9) - (HAND_PRIORITY[b.part] ?? 9) || b.velocity - a.velocity,
    );
    for (const h of hands.slice(MAX_HANDS_AT_ONCE)) drop.add(h);
  }
  return hits.filter((h) => !drop.has(h));
}


function detectPhase(hits: CleanHit[], stepsPerBar: number, beatOffset: number): number {
  const beats = stepsPerBar / STEPS_PER_BEAT;
  let best = 0;
  let bestScore = -Infinity;
  for (let o = 0; o < stepsPerBar; o++) {
    let score = 0;
    for (const h of hits) {
      const local = (((h.step - o) % stepsPerBar) + stepsPerBar) % stepsPerBar;
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
