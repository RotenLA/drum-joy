/**
 * 基础鼓节奏型谱面：MIDI 只提供小节网格、每段疏密、重音位置与过门位置，
 * 实际音符从节奏型库中挑选，同一乐句内重复同一型，只在乐句尾加变化/过门。
 */
import type { PartId } from "./laneLayouts";
import type { BarSkeleton, Skeleton } from "./skeleton";

export type PatternDifficulty = "easy" | "beginner" | "standard" | "hard";

export interface PatternHit {
  step: number;
  part: PartId;
  velocity: number;
  open?: boolean;
}

/** 0 安静 / 1 普通 / 2 密集 */
type Level = 0 | 1 | 2;

interface BarCtx {
  beats: number;
  spb: number; // steps per beat (4)
  level: Level;
  bar: BarSkeleton;
  ride: boolean;
  variant: boolean; // 乐句尾小变化
}

type Gen = (c: BarCtx) => Array<[number, PartId, number?]>;

const beatsOf = (c: BarCtx) => Array.from({ length: c.beats }, (_, i) => i);
/** 军鼓反拍位置（4/4 → 2、4 拍；3/4 → 2、3 拍；其他取偶数拍） */
const backbeats = (c: BarCtx) =>
  c.beats === 3 ? [1, 2] : beatsOf(c).filter((b) => b % 2 === 1);

/** 从候选底鼓型中挑与 MIDI 底鼓最吻合的一个（以八分为单位） */
function pickKick(c: BarCtx, candidates: number[][]): number[] {
  const src = c.bar.slots.kick ?? [];
  if (src.length === 0) return candidates[0]!;
  let best = candidates[0]!;
  let bestScore = -Infinity;
  for (const cand of candidates) {
    let score = 0;
    for (const e of cand) {
      const step = (e * c.spb) / 2;
      score += src.some((s) => Math.abs(s - step) <= 1) ? 2 : -1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

function kickCandidates(c: BarCtx, rich: boolean): number[][] {
  const e = c.beats * 2; // 八分数
  const base = [0, ...(c.beats >= 4 ? [4] : [])];
  const list: number[][] = [[0], base];
  if (c.beats >= 4) {
    list.push([0, 5], [0, 4, 5]);
    if (rich) list.push([0, 3, 4], [0, 1, 4], [0, 3, 5], [0, 4, 6]);
  }
  return list.filter((k) => k.every((x) => x < e));
}

const EASY: Gen = (c) => {
  const out: Array<[number, PartId, number?]> = [];
  const bb = backbeats(c);
  if (c.level === 0) {
    for (const b of beatsOf(c)) out.push([b * c.spb, "hihat"]);
    out.push([(bb[bb.length - 1] ?? 0) * c.spb, "snare"]);
  } else {
    const eighths = c.level === 2 || c.variant;
    for (const b of beatsOf(c)) {
      out.push([b * c.spb, "hihat"]);
      if (eighths && !bb.includes(b)) out.push([b * c.spb + c.spb / 2, "hihat"]);
    }
    for (const b of bb) out.push([b * c.spb, "snare"]);
    // 偶尔正拍军鼓：乐句尾最后一拍加一下
    if (c.variant && c.beats >= 4) out.push([(c.beats - 2) * c.spb, "snare"]);
  }
  return out;
};

const BEGINNER: Gen = (c) => {
  const out: Array<[number, PartId, number?]> = [];
  const bb = backbeats(c);
  const eighthHat = c.level >= 1;
  for (const b of beatsOf(c)) {
    out.push([b * c.spb, "hihat"]);
    if (eighthHat) out.push([b * c.spb + c.spb / 2, "hihat"]);
  }
  if (c.level === 0) {
    out.push([0, "kick"]);
    out.push([(bb[bb.length - 1] ?? 0) * c.spb, "snare"]);
    return out;
  }
  for (const b of bb) out.push([b * c.spb, "snare"]);
  const kicks = c.variant || c.level === 2 ? pickKick(c, kickCandidates(c, false)) : kickCandidates(c, false)[1]!;
  for (const k of kicks) out.push([(k * c.spb) / 2, "kick"]);
  return out;
};

const STANDARD: Gen = (c) => {
  const out: Array<[number, PartId, number?]> = [];
  const bb = backbeats(c);
  const cym: PartId = c.ride ? "ride" : "hihat";
  for (const b of beatsOf(c)) {
    out.push([b * c.spb, cym]);
    if (c.level >= 1) out.push([b * c.spb + c.spb / 2, cym]);
  }
  for (const b of c.level === 0 ? bb.slice(-1) : bb) out.push([b * c.spb, "snare"]);
  const kicks = c.level === 0 ? [0] : pickKick(c, kickCandidates(c, true));
  for (const k of kicks) out.push([(k * c.spb) / 2, "kick"]);
  if (c.bar.isPhraseStart && c.level >= 1 && (c.bar.slots.crash?.length ?? 0) > 0) out.push([0, "crash", 115]);
  for (const s of c.bar.openHat) if (!c.ride && s % (c.spb / 2) === 0) out.push([s, "hihat", 100]);
  return out;
};

const HARD: Gen = (c) => {
  const out = STANDARD(c);
  const src = c.bar.slots.kick ?? [];
  // 困难：密集段底鼓更贴近 MIDI（允许十六分，但每拍最多 2 下），镲随 MIDI 细分
  if (c.level === 2) {
    const perBeat = new Map<number, number>();
    for (const s of src) {
      const b = Math.floor(s / c.spb);
      if ((perBeat.get(b) ?? 0) >= 2) continue;
      perBeat.set(b, (perBeat.get(b) ?? 0) + 1);
      out.push([s, "kick"]);
    }
    if (c.bar.hatDiv === 16 && !c.ride) {
      for (const b of beatsOf(c)) for (const q of [1, 3]) out.push([b * c.spb + q, "hihat", 80]);
    }
  }
  return out;
};

const GEN: Record<PatternDifficulty, Gen> = { easy: EASY, beginner: BEGINNER, standard: STANDARD, hard: HARD };

/** 乐句尾过门：替换小节后半段 */
function fill(c: BarCtx, diff: PatternDifficulty, base: Array<[number, PartId, number?]>) {
  const beats = diff === "easy" || diff === "beginner" ? 1 : 2;
  const from = Math.max(0, c.beats - beats) * c.spb;
  const keep = base.filter(([s, p]) => s < from || p === "kick");
  const div = diff === "easy" ? c.spb : diff === "beginner" || diff === "standard" ? c.spb / 2 : c.spb / 4;
  const toms: PartId[] =
    diff === "hard" ? ["snare", "highTom", "midTom", "floorTom"] : diff === "standard" ? ["snare", "floorTom"] : ["snare"];
  const slots: number[] = [];
  for (let s = from; s < c.beats * c.spb; s += div) slots.push(s);
  slots.forEach((s, i) => {
    const part = toms[Math.min(toms.length - 1, Math.floor((i * toms.length) / slots.length))]!;
    keep.push([s, part, 100]);
  });
  return keep;
}

function levelOf(bar: BarSkeleton, median: number, beats: number): Level {
  const n = bar.noteCount;
  if (n === 0 || n < Math.max(2, median * 0.45)) return 0;
  if (n > median * 1.35 || bar.hatDiv === 16 || (bar.hatDiv === 8 && n >= beats * 3)) return 2;
  return 1;
}

export function patternEmits(sk: Skeleton, diff: PatternDifficulty, beatsPerBar: number): PatternHit[] {
  const { bars, stepsPerBeat: spb } = sk;
  if (bars.length === 0) return [];
  const beats = Math.max(1, Math.round(sk.stepsPerBar / spb) || beatsPerBar);
  const counts = bars.map((b) => b.noteCount).filter((n) => n > 0).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 1;
  const levels = bars.map((b) => levelOf(b, median, beats));

  const out: PatternHit[] = [];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    // 乐句（4 小节）内统一疏密：取众数，避免一小节一个型
    const ps = i - (bar.index % 4);
    const phrase = levels.slice(Math.max(0, ps), ps + 4);
    const tally = [0, 0, 0];
    for (const l of phrase) tally[l]!++;
    let level = (tally.indexOf(Math.max(...tally)) as Level) ?? 1;
    // 原 MIDI 有鼓的乐句至少普通档；空乐句保底安静档，保证不空
    if (level === 0 && phrase.some((l) => l > 0)) level = 1;
    const posInPhrase = bar.index % 4;
    const phraseEnd = posInPhrase === 3;
    const nextPhraseStart = bars[i + 1]?.isPhraseStart ?? false;
    const c: BarCtx = {
      beats,
      spb,
      level,
      bar,
      ride: diff !== "easy" && diff !== "beginner" && bar.ridePrimary,
      variant: phraseEnd && bar.index % 8 === 7,
    };
    let hits = GEN[diff](c);
    const doFill = bar.isFill || (phraseEnd && nextPhraseStart && bar.index % 8 === 7 && level >= 1);
    if (doFill) hits = fill(c, diff, hits);
    const seen = new Set<string>();
    for (const [local, part, vel] of hits) {
      if (local < 0 || local >= sk.stepsPerBar) continue;
      const key = `${local}:${part}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hit: PatternHit = {
        step: bar.startStep + local,
        part,
        velocity: vel ?? (local === 0 || part === "snare" ? 104 : 90),
      };
      if (part === "hihat") hit.open = vel === 100 && diff !== "easy" && diff !== "beginner";
      out.push(hit);
    }
  }
  return out.sort((a, b) => a.step - b.step);
}
