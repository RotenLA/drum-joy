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

/** 镲的拍位（按细分/摇摆展开到目标小节拍数） */
export function hatBeats(pattern: GroovePattern, beatsPerBar: number, div?: 1 | 2 | 4): number[] {
  const d = div ?? pattern.hatDiv;
  const out: number[] = [];
  for (let beat = 0; beat < beatsPerBar; beat += 1) {
    for (let k = 0; k < d; k++) {
      let b = beat + k / d;
      if (pattern.hatSwing && d === 2 && k === 1) b = beat + 0.5 + pattern.hatSwing;
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
