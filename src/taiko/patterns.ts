/**
 * 歌曲专属节奏型谱面。
 *
 * 流程：清洗后的骨架 → 小节律动聚类（提取这首歌出现频次最高的 2~3 个主干型）
 * → 四档难度在主干型基础上按各档规则取舍 → 乐句尾变化 / 过门。
 * 音符时间在 difficulty 层回填原 MIDI 的真实击打毫秒（见 alignEmits）。
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

/** 一个小节的主干律动（位置单位：八分音符） */
export interface GrooveTemplate {
  kick8: number[];
  snare8: number[];
  hatDiv: 4 | 8 | 16;
  count: number;
}

interface BarCtx {
  beats: number;
  spb: number; // steps per beat (4)
  level: Level;
  bar: BarSkeleton;
  ride: boolean;
  variant: boolean; // 乐句尾小变化
  groove: GrooveTemplate;
}

type Gen = (c: BarCtx) => Array<[number, PartId, number?]>;

const beatsOf = (c: BarCtx) => Array.from({ length: c.beats }, (_, i) => i);
/** 军鼓反拍位置（4/4 → 2、4 拍；3/4 → 2、3 拍；其他取偶数拍） */
const backbeats = (c: BarCtx) =>
  c.beats === 3 ? [1, 2] : beatsOf(c).filter((b) => b % 2 === 1);

const uniqSort = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

// ================= 律动提取 =================

function defaultGroove(beats: number, level: Level): GrooveTemplate {
  const bb = beats === 3 ? [1, 2] : Array.from({ length: beats }, (_, i) => i).filter((b) => b % 2 === 1);
  return {
    kick8: beats >= 4 ? (level === 2 ? [0, 5] : [0, 4]) : [0],
    snare8: bb.map((b) => b * 2),
    hatDiv: level === 2 ? 8 : 4,
    count: 0,
  };
}

/**
 * 把每小节的底鼓 / 军鼓 / 镲细分投影到八分网格，按疏密档位统计频次，
 * 取出现最多的一型作为该档的主干律动 —— 这样每首歌都有自己的律动个性。
 */
export function extractGrooves(sk: Skeleton, beats: number): Record<Level, GrooveTemplate> {
  const spb = sk.stepsPerBeat;
  const eighth = Math.max(1, spb / 2);
  const counts = sk.bars.map((b) => b.noteCount).filter((n) => n > 0).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 1;

  const tally = new Map<string, GrooveTemplate & { level: Level }>();
  for (const bar of sk.bars) {
    if (bar.noteCount === 0 || bar.isFill) continue;
    const level = levelOf(bar, median, beats);
    if (level === 0) continue;
    const to8 = (slots: number[] | undefined) =>
      uniqSort((slots ?? []).map((s) => Math.round(s / eighth))).filter((s) => s < beats * 2);
    const kick8 = to8(bar.slots.kick);
    const snare8 = to8(bar.slots.snare);
    if (kick8.length === 0 && snare8.length === 0) continue;
    const hatDiv = bar.hatDiv === 0 ? 4 : bar.hatDiv;
    const key = `${level}|${kick8.join(",")}|${snare8.join(",")}|${hatDiv}`;
    const prev = tally.get(key);
    if (prev) prev.count++;
    else tally.set(key, { kick8, snare8, hatDiv, count: 1, level });
  }

  const best: Record<Level, GrooveTemplate | undefined> = { 0: undefined, 1: undefined, 2: undefined };
  for (const t of tally.values()) {
    const cur = best[t.level];
    if (!cur || t.count > cur.count) best[t.level] = { kick8: t.kick8, snare8: t.snare8, hatDiv: t.hatDiv, count: t.count };
  }

  const pick = (level: Level): GrooveTemplate => {
    const found = best[level] ?? best[1] ?? best[2] ?? best[0];
    if (!found) return defaultGroove(beats, level);
    return sanitize(found, beats);
  };
  return { 0: pick(0), 1: pick(1), 2: pick(2) };
}

/** 主干型安全化：底鼓必含首拍且不过密，军鼓缺失时补反拍 */
function sanitize(t: GrooveTemplate, beats: number): GrooveTemplate {
  const bb = beats === 3 ? [1, 2] : Array.from({ length: beats }, (_, i) => i).filter((b) => b % 2 === 1);
  let kick8 = uniqSort([0, ...t.kick8]).slice(0, Math.max(2, beats));
  let snare8 = uniqSort(t.snare8).slice(0, Math.max(2, beats));
  if (snare8.length === 0) snare8 = bb.map((b) => b * 2);
  if (kick8.length === 0) kick8 = [0];
  return { kick8, snare8, hatDiv: t.hatDiv, count: t.count };
}

const quarterOnly = (xs8: number[]) => uniqSort(xs8.filter((x) => x % 2 === 0));

// ================= 四档生成 =================

const EASY: Gen = (c) => {
  const out: Array<[number, PartId, number?]> = [];
  const bb = backbeats(c);
  // 轻松：只用正拍，绝不切分
  let snares = quarterOnly(c.groove.snare8).map((x) => x / 2);
  if (snares.length === 0) snares = bb;
  if (c.level === 0) snares = snares.slice(-1);
  for (const b of beatsOf(c)) out.push([b * c.spb, "hihat"]);
  for (const b of snares) out.push([b * c.spb, "snare"]);
  return out;
};

const BEGINNER: Gen = (c) => {
  const out: Array<[number, PartId, number?]> = [];
  const bb = backbeats(c);
  const eighthHat = c.level === 2;
  for (const b of beatsOf(c)) {
    out.push([b * c.spb, "hihat"]);
    if (eighthHat) out.push([b * c.spb + c.spb / 2, "hihat"]);
  }
  let snares = quarterOnly(c.groove.snare8).map((x) => x / 2);
  if (snares.length === 0) snares = bb;
  if (c.level === 0) {
    out.push([0, "kick"]);
    out.push([(snares[snares.length - 1] ?? 0) * c.spb, "snare"]);
    return out;
  }
  for (const b of snares) out.push([b * c.spb, "snare"]);
  // 入门：底鼓尽量少切分，取主干型里的正拍位（首拍必留）
  const kicks = uniqSort([0, ...quarterOnly(c.groove.kick8)]).slice(0, 2);
  for (const k of kicks) out.push([(k * c.spb) / 2, "kick"]);
  return out;
};

const STANDARD: Gen = (c) => {
  const out: Array<[number, PartId, number?]> = [];
  const bb = backbeats(c);
  const cym: PartId = c.ride ? "ride" : "hihat";
  const eighthCym = c.level >= 1 && c.groove.hatDiv >= 8;
  for (const b of beatsOf(c)) {
    out.push([b * c.spb, cym]);
    if (eighthCym) out.push([b * c.spb + c.spb / 2, cym]);
  }
  let snare8 = c.groove.snare8;
  if (snare8.length === 0) snare8 = bb.map((b) => b * 2);
  for (const s of c.level === 0 ? snare8.slice(-1) : snare8) out.push([(s * c.spb) / 2, "snare"]);
  const kick8 = c.level === 0 ? [0] : c.groove.kick8;
  for (const k of kick8.slice(0, 4)) out.push([(k * c.spb) / 2, "kick"]);
  if (c.bar.isPhraseStart && c.level >= 1 && (c.bar.slots.crash?.length ?? 0) > 0) out.push([0, "crash", 115]);
  for (const s of c.bar.openHat) if (!c.ride && s % (c.spb / 2) === 0) out.push([s, "hihat", 100]);
  return out;
};

const HARD: Gen = (c) => {
  const out = STANDARD(c);
  const src = c.bar.slots.kick ?? [];
  // 困难：密集段底鼓更贴近 MIDI（允许十六分，但每拍最多 2 下）
  if (c.level === 2) {
    const perBeat = new Map<number, number>();
    for (const s of src) {
      const b = Math.floor(s / c.spb);
      if ((perBeat.get(b) ?? 0) >= 2) continue;
      perBeat.set(b, (perBeat.get(b) ?? 0) + 1);
      out.push([s, "kick"]);
    }
    // 密集段军鼓也吃一次原曲的反拍细分，让副歌更有存在感
    for (const s of c.bar.slots.snare ?? []) {
      if (s % (c.spb / 2) === 0) out.push([s, "snare"]);
    }
  }
  return out;
};

const GEN: Record<PatternDifficulty, Gen> = { easy: EASY, beginner: BEGINNER, standard: STANDARD, hard: HARD };

/** 乐句尾过门：替换小节后半段 */
function fill(c: BarCtx, diff: PatternDifficulty, base: Array<[number, PartId, number?]>) {
  const beats = diff === "hard" ? 2 : 1;
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
  const grooves = extractGrooves(sk, beats);

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
      groove: grooves[level],
    };
    let hits = GEN[diff](c);
    const doFill = (diff === "hard" && bar.isFill) || (phraseEnd && nextPhraseStart && bar.index % 8 === 7 && level >= 1);
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
