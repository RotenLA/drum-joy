/**
 * 标准节奏型库：把每小节的骨架归类到最接近的一个标准节奏型，
 * 「标准」难度用它重写小节，保证手感稳定又不脱离原曲。
 * 网格为 4/4 一小节 16 格（16 分音符）。
 */
import type { BarSkeleton } from "./skeleton";

export interface GroovePattern {
  id: string;
  label: string;
  kick: readonly number[];
  snare: readonly number[];
  /** 镲的默认细分 */
  hatDiv: 4 | 8 | 16;
}

export const GROOVE_PATTERNS: readonly GroovePattern[] = [
  { id: "ballad", label: "抒情 4 分", kick: [0, 8], snare: [4, 12], hatDiv: 4 },
  { id: "rock8", label: "8 分摇滚", kick: [0, 8], snare: [4, 12], hatDiv: 8 },
  { id: "rock8b", label: "8 分变体", kick: [0, 8, 10], snare: [4, 12], hatDiv: 8 },
  { id: "syncop", label: "切分底鼓", kick: [0, 6, 10], snare: [4, 12], hatDiv: 8 },
  { id: "four", label: "四踩", kick: [0, 4, 8, 12], snare: [4, 12], hatDiv: 8 },
  { id: "halftime", label: "半拍", kick: [0, 10], snare: [8], hatDiv: 8 },
  { id: "sixteen", label: "16 分踩镲", kick: [0, 3, 8, 11], snare: [4, 12], hatDiv: 16 },
  { id: "funk", label: "放克", kick: [0, 3, 6, 10], snare: [4, 12], hatDiv: 16 },
  { id: "sparse", label: "稀疏底鼓", kick: [0], snare: [8], hatDiv: 8 },
  { id: "drive", label: "推进摇滚", kick: [0, 7, 8, 10], snare: [4, 12], hatDiv: 8 },
  { id: "dance", label: "舞曲切分", kick: [0, 4, 8, 12], snare: [4, 12], hatDiv: 16 },
  { id: "shuffle", label: "摇摆重音", kick: [0, 6, 8], snare: [4, 12, 14], hatDiv: 8 },
];

function similarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setB = new Set(b);
  let hit = 0;
  for (const x of a) if (setB.has(x)) hit++;
  return (2 * hit) / (a.length + b.length || 1);
}

/** 与骨架最接近的节奏型（非 4/4 返回 null，交给原样保留） */
export function matchPattern(bar: BarSkeleton, stepsPerBar: number): GroovePattern | null {
  if (stepsPerBar !== 16) return null;
  const kick = bar.slots.kick ?? [];
  const snare = bar.slots.snare ?? [];
  if (kick.length === 0 && snare.length === 0) return null;
  let best: GroovePattern | null = null;
  let bestScore = -Infinity;
  for (const p of GROOVE_PATTERNS) {
    const hatScore = p.hatDiv === bar.hatDiv ? 0.18 : 0;
    const phraseBias = bar.index % 4 === 2 && p.id.endsWith("b") ? 0.08 : 0;
    const score = similarity(kick, p.kick) * 1.25 + similarity(snare, p.snare) * 1.1 + hatScore + phraseBias;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}
