/**
 * 基础节奏型库：游玩谱面的真正骨架。
 * 自动分析只用来「理解这首歌的感觉」，实际编谱用这里的规整鼓型，
 * 保证好打；变体与过门也在此定义，编谱器按小节能量取用。
 */
import type { PartId } from "./laneLayouts";

/** 骨架/变体中的一击：beat 为相对小节首拍的拍位置 */
export interface GrooveHit {
  beat: number;
  part: PartId;
}

export interface GroovePattern {
  id: string;
  label: string;
  /** 设计时的每小节拍数（4 = 4/4，3 = 3/4，6 = 6/8 的六个八分） */
  beatsPerBar: number;
  /** 底鼓拍位 */
  kick: number[];
  /** 军鼓拍位 */
  snare: number[];
  /** 镲每拍细分数（1 = 四分，2 = 八分，4 = 十六分） */
  hatDiv: 1 | 2 | 4;
  /** 镲偏移（shuffle 用，占一拍的比例） */
  hatSwing?: number;
  /** 自定义节奏的镲拍位（存在时优先于 hatDiv 展开） */
  hatCustom?: number[];
  /** 适用 BPM 区间（软条件，超出只减分） */
  bpm: [number, number];
  /** 强度等级 1 安静 / 2 常规 / 3 激烈 */
  intensity: 1 | 2 | 3;
  /** 乐句末过门（相对小节末尾的拍偏移，负数表示往前） */
  fill: GrooveHit[];
}

export const GROOVE_PATTERNS: readonly GroovePattern[] = [
  {
    id: "rock8",
    label: "八分摇滚",
    beatsPerBar: 4,
    kick: [0, 2],
    snare: [1, 3],
    hatDiv: 2,
    bpm: [80, 160],
    intensity: 2,
    fill: [
      { beat: -1, part: "highTom" },
      { beat: -0.5, part: "midTom" },
      { beat: -0.25, part: "floorTom" },
    ],
  },
  {
    id: "rock16",
    label: "十六分摇滚",
    beatsPerBar: 4,
    kick: [0, 1.5, 2],
    snare: [1, 3],
    hatDiv: 4,
    bpm: [90, 150],
    intensity: 3,
    fill: [
      { beat: -1, part: "highTom" },
      { beat: -0.75, part: "highTom" },
      { beat: -0.5, part: "midTom" },
      { beat: -0.25, part: "floorTom" },
    ],
  },
  {
    id: "four",
    label: "四踩 / Disco",
    beatsPerBar: 4,
    kick: [0, 1, 2, 3],
    snare: [1, 3],
    hatDiv: 2,
    bpm: [110, 145],
    intensity: 3,
    fill: [
      { beat: -0.5, part: "snare" },
      { beat: -0.25, part: "floorTom" },
    ],
  },
  {
    id: "halftime",
    label: "半拍 Half-time",
    beatsPerBar: 4,
    kick: [0, 2.5],
    snare: [2],
    hatDiv: 2,
    bpm: [60, 110],
    intensity: 2,
    fill: [
      { beat: -0.5, part: "midTom" },
      { beat: -0.25, part: "floorTom" },
    ],
  },
  {
    id: "shuffle",
    label: "Shuffle 三连感",
    beatsPerBar: 4,
    kick: [0, 2],
    snare: [1, 3],
    hatDiv: 2,
    hatSwing: 0.167,
    bpm: [80, 140],
    intensity: 2,
    fill: [
      { beat: -0.67, part: "midTom" },
      { beat: -0.33, part: "floorTom" },
    ],
  },
  {
    id: "ballad",
    label: "Ballad 慢速简约",
    beatsPerBar: 4,
    kick: [0],
    snare: [2],
    hatDiv: 1,
    bpm: [50, 95],
    intensity: 1,
    fill: [{ beat: -0.5, part: "snare" }],
  },
  {
    id: "funk",
    label: "Funk 切分",
    beatsPerBar: 4,
    kick: [0, 0.75, 2.5],
    snare: [1, 3],
    hatDiv: 4,
    bpm: [85, 125],
    intensity: 3,
    fill: [
      { beat: -1, part: "snare" },
      { beat: -0.75, part: "highTom" },
      { beat: -0.5, part: "midTom" },
      { beat: -0.25, part: "floorTom" },
    ],
  },
  {
    id: "compound68",
    label: "6/8 复合拍",
    beatsPerBar: 6,
    kick: [0, 3],
    snare: [2, 5],
    hatDiv: 1,
    bpm: [60, 130],
    intensity: 2,
    fill: [
      { beat: -1, part: "midTom" },
      { beat: -0.5, part: "floorTom" },
    ],
  },
  {
    id: "waltz",
    label: "3/4 华尔兹",
    beatsPerBar: 3,
    kick: [0],
    snare: [1, 2],
    hatDiv: 1,
    bpm: [60, 160],
    intensity: 1,
    fill: [{ beat: -0.5, part: "midTom" }],
  },
];

export const GROOVE_BY_ID = Object.fromEntries(
  GROOVE_PATTERNS.map((g) => [g.id, g]),
) as Record<string, GroovePattern>;

/**
 * 镲的拍位（按细分/摇摆展开到目标小节拍数）。
 * 始终从每拍正拍开始生成，正拍必有；细分降级时只去掉反拍与十六分。
 */
export function hatBeats(
  pattern: GroovePattern,
  beatsPerBar: number,
  div?: 1 | 2 | 4,
  swing?: number,
): number[] {
  const d = div ?? pattern.hatDiv;
  const sw = swing ?? pattern.hatSwing ?? 0;
  if (pattern.hatCustom) {
    // 自定义节奏：保留落在允许网格上的镲，并保证每拍正拍存在
    const grid = 1 / d;
    const set = new Set<number>();
    for (const b of pattern.hatCustom) {
      const snapped = Math.round(b / grid) * grid;
      if (snapped >= 0 && snapped < beatsPerBar) set.add(Math.round(snapped * 1000) / 1000);
    }
    return [...set].sort((a, b) => a - b);
  }
  const out: number[] = [];
  for (let beat = 0; beat < beatsPerBar; beat += 1) {
    for (let k = 0; k < d; k++) {
      let b = beat + k / d;
      if (sw && d === 2 && k === 1) b = beat + 0.5 + sw;
      if (b < beatsPerBar) out.push(Math.round(b * 1000) / 1000);
    }
  }
  return out;
}

/** 骨架拍位缩放到目标小节拍数（拍号与设计不同时按比例折算） */
export function scaleBeats(beats: readonly number[], from: number, to: number): number[] {
  if (from === to) return [...beats];
  const k = to / from;
  return beats
    .map((b) => Math.round(b * k * 4) / 4)
    .filter((b) => b >= 0 && b < to);
}

/** 自定义一小节（三轨 16 分位图）→ 临时基础节奏型 */
export interface CustomPattern {
  kick: boolean[];
  snare: boolean[];
  hihat: boolean[];
}

export const CUSTOM_GROOVE_ID = "__custom__";

export function patternFromCustom(
  custom: CustomPattern,
  beatsPerBar: number,
  bpm: number,
): GroovePattern {
  const toBeats = (cells: boolean[]) =>
    cells
      .map((on, i) => (on ? i / 4 : -1))
      .filter((b) => b >= 0 && b < beatsPerBar);
  const hats = toBeats(custom.hihat);
  const hatPerBeat = hats.length / Math.max(1, beatsPerBar);
  return {
    id: CUSTOM_GROOVE_ID,
    label: "自定义节奏",
    beatsPerBar,
    kick: toBeats(custom.kick),
    snare: toBeats(custom.snare),
    hatDiv: hatPerBeat >= 2.6 ? 4 : hatPerBeat >= 1.4 ? 2 : 1,
    hatCustom: hats,
    bpm: [Math.max(40, bpm - 40), bpm + 40],
    intensity: 2,
    fill: [
      { beat: -0.5, part: "midTom" },
      { beat: -0.25, part: "floorTom" },
    ],
  };
}

/** 空白自定义节奏（按拍号生成格子数） */
export function emptyCustom(beatsPerBar: number): CustomPattern {
  const n = Math.max(4, Math.round(beatsPerBar * 4));
  return {
    kick: Array<boolean>(n).fill(false),
    snare: Array<boolean>(n).fill(false),
    hihat: Array<boolean>(n).fill(false),
  };
}

/** 调整自定义节奏长度以匹配拍号 */
export function resizeCustom(custom: CustomPattern, beatsPerBar: number): CustomPattern {
  const n = Math.max(4, Math.round(beatsPerBar * 4));
  const fit = (cells: boolean[]) =>
    Array.from({ length: n }, (_, i) => cells[i] ?? false);
  return { kick: fit(custom.kick), snare: fit(custom.snare), hihat: fit(custom.hihat) };
}

export function customIsEmpty(custom: CustomPattern): boolean {
  return ![...custom.kick, ...custom.snare, ...custom.hihat].some(Boolean);
}

