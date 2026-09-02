/**
 * 游玩难度：入门 / 标准 / 困难。
 * - 入门：5 分区 + 原 MIDI（只保留 5 件，丢弃其余，并限制最小间隔）
 * - 标准：9 分区 + 原 MIDI，一音不改
 * - 困难：9 分区 + 原 MIDI + 适度加密加花（确定性，同曲每次一致）
 */
import type { TaikoChart, TaikoNote } from "@/shared/taikoChart";
import { VISIBLE_PARTS, type LayoutMode, type PartId } from "./laneLayouts";
import { noteForPart } from "./midiChart";
import type { ParsedMidi } from "./midiFile";
import { buildChartFromMidi, type MidiChartOptions } from "./midiChart";

export type Difficulty = "beginner" | "standard" | "hard";

export const DIFFICULTIES: readonly { id: Difficulty; label: string; hint: string }[] = [
  { id: "beginner", label: "入门", hint: "5 分区 · 原 MIDI" },
  { id: "standard", label: "标准", hint: "9 分区 · 原 MIDI" },
  { id: "hard", label: "困难", hint: "9 分区 · 加密加花" },
];

export function layoutOf(diff: Difficulty): LayoutMode {
  return diff === "beginner" ? "five" : "nine";
}

/** 入门档最小间隔（毫秒），避免打不出的连打 */
const BEGINNER_MIN_GAP = 120;
/** 同一时刻视为和音的容差 */
const CHORD_MS = 20;
/** 困难档新增音符占原谱比例上限 */
const HARD_ADD_RATIO = 0.15;

function partOfChartNote(n: TaikoNote, noteToPart: Map<number, PartId>): PartId | null {
  return n.note !== undefined ? (noteToPart.get(n.note) ?? null) : null;
}

function buildNoteToPart(): Map<number, PartId> {
  const m = new Map<number, PartId>();
  for (const p of VISIBLE_PARTS.nine) m.set(noteForPart(p), p);
  return m;
}

/** 32 位确定性伪随机 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function keepOnlyParts(chart: TaikoChart, parts: readonly PartId[]): TaikoNote[] {
  const noteToPart = buildNoteToPart();
  const allow = new Set(parts);
  return chart.notes.filter((n) => {
    const p = partOfChartNote(n, noteToPart);
    return p !== null && allow.has(p);
  });
}

/** 入门：限制最小间隔（同一时刻的和音最多保留 2 件，优先底鼓/军鼓） */
function thinForBeginner(notes: TaikoNote[]): TaikoNote[] {
  const noteToPart = buildNoteToPart();
  const priority: Record<string, number> = {
    kick: 0,
    snare: 1,
    hihat: 2,
    pedalHat: 3,
    floorTom: 4,
  };
  const out: TaikoNote[] = [];
  let i = 0;
  let lastGroupTime = -Infinity;
  while (i < notes.length) {
    const t = notes[i]!.timeMs;
    const group: TaikoNote[] = [];
    while (i < notes.length && notes[i]!.timeMs - t <= CHORD_MS) group.push(notes[i++]!);
    if (t - lastGroupTime < BEGINNER_MIN_GAP) continue;
    group.sort((a, b) => {
      const pa = partOfChartNote(a, noteToPart) ?? "";
      const pb = partOfChartNote(b, noteToPart) ?? "";
      return (priority[pa] ?? 9) - (priority[pb] ?? 9);
    });
    out.push(...group.slice(0, 2));
    lastGroupTime = t;
  }
  return out;
}

/** 困难：乐句末过门 + 镲适度加密，新增量受 HARD_ADD_RATIO 限制 */
function embellish(chart: TaikoChart): TaikoNote[] {
  const noteToPart = buildNoteToPart();
  const base = chart.notes;
  if (base.length === 0) return base;
  const beatMs = 60000 / chart.bpm;
  const beatsPerBar = Math.max(1, chart.timeSignature[0] * (4 / chart.timeSignature[1]));
  const barMs = beatMs * beatsPerBar;
  const budget = Math.floor(base.length * HARD_ADD_RATIO);
  if (budget <= 0) return base;

  const times = base.map((n) => n.timeMs);
  const occupied = (t: number): boolean => {
    // 二分找最近音符
    let lo = 0;
    let hi = times.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const d = times[mid]! - t;
      if (Math.abs(d) < 45) return true;
      if (d < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  };

  const added: TaikoNote[] = [];
  const rand = mulberry32(Math.round(chart.bpm * 1000) ^ base.length);

  // 1) 镲加密：相邻同为踩镲/叮叮镲且间隔约一拍 → 补中间那一下
  for (let i = 0; i + 1 < base.length && added.length < budget; i++) {
    const a = base[i]!;
    const b = base[i + 1]!;
    const pa = partOfChartNote(a, noteToPart);
    if (pa !== "hihat" && pa !== "ride") continue;
    if (partOfChartNote(b, noteToPart) !== pa) continue;
    const gap = b.timeMs - a.timeMs;
    if (gap < beatMs * 0.45 || gap > beatMs * 1.15) continue;
    if (rand() > 0.55) continue;
    const t = a.timeMs + gap / 2;
    if (occupied(t)) continue;
    added.push({ timeMs: t, lane: "ka", note: a.note });
  }

  // 2) 乐句末过门：每 4 小节最后一拍加 3 连通鼓下行
  const firstMs = base[0]!.timeMs;
  const lastMs = base[base.length - 1]!.timeMs;
  const fillParts: PartId[] = ["highTom", "midTom", "floorTom"];
  for (let bar = 0; added.length < budget; bar++) {
    const barStart = firstMs + bar * barMs;
    if (barStart > lastMs) break;
    if (bar % 4 !== 3) continue;
    if (rand() > 0.8) continue;
    const fillStart = barStart + barMs - beatMs;
    for (let k = 0; k < 3 && added.length < budget; k++) {
      const t = fillStart + (k * beatMs) / 3;
      if (occupied(t)) continue;
      added.push({
        timeMs: t,
        lane: "ka",
        note: noteForPart(fillParts[k]!),
      });
    }
  }

  return [...base, ...added].sort((a, b) => a.timeMs - b.timeMs);
}

/** 按难度加工谱面 */
export function applyDifficulty(chart: TaikoChart, diff: Difficulty): TaikoChart {
  const layout = layoutOf(diff);
  let notes = keepOnlyParts(chart, VISIBLE_PARTS[layout]);
  if (diff === "beginner") notes = thinForBeginner(notes);
  const shaped = { ...chart, notes };
  if (diff === "hard") return { ...shaped, notes: embellish(shaped) };
  return shaped;
}

/** MIDI → 按难度成谱（谱面屏与游玩屏共用） */
export function buildPlayChart(
  midi: ParsedMidi,
  opts: MidiChartOptions,
  diff: Difficulty,
): TaikoChart {
  return applyDifficulty(buildChartFromMidi(midi, opts), diff);
}
