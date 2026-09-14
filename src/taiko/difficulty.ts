/**
 * 三档难度：入门 / 标准 / 困难。
 * 都不再直接吃原始 MIDI，而是走「量化降噪 → 小节骨架」后重新编写：
 * - 入门（5 分区）：底鼓与军鼓大部分正拍，踩镲八分为主，过门用地通简单收尾
 * - 标准（9 分区）：每小节归类到标准节奏型重写，过门小节保留原始细节
 * - 困难（9 分区）：原样保留 + 手脚交替强化（确定性，同曲每次一致）
 */
import type { TaikoChart, TaikoNote } from "@/shared/taikoChart";
import { VISIBLE_PARTS, type LayoutMode, type PartId } from "./laneLayouts";
import { noteForPart, type MidiChartOptions } from "./midiChart";
import { tickToMs, type ParsedMidi } from "./midiFile";
import { cleanMidi, type CleanedMidi, type CleanHit } from "./midiClean";
import { buildSkeleton, hasNear, type BarSkeleton, type Skeleton } from "./skeleton";
import { matchPattern } from "./patternLib";

export type Difficulty = "easy" | "beginner" | "standard" | "hard";

export const DIFFICULTIES: readonly { id: Difficulty; label: string; hint: string }[] = [
  { id: "easy", label: "轻松", hint: "军鼓 · 踩镲 · 左踏板踩住" },
  { id: "beginner", label: "入门", hint: "轻松 + 右踏板" },
  { id: "standard", label: "标准", hint: "加入低通 / 吊镲 / 叮叮镲" },
  { id: "hard", label: "困难", hint: "全部鼓件，含高通 / 中通" },
];

export function layoutOf(diff: Difficulty): LayoutMode {
  return diff === "easy" || diff === "beginner" ? "five" : diff === "standard" ? "seven" : "nine";
}

/**
 * 各难度允许出现「音符」的部件（与显示的鼓盘不同：
 * 轻松/入门显示 5 个鼓盘，但轻松不出右踏板音符）。
 */
export const NOTE_PARTS: Record<Difficulty, readonly PartId[]> = {
  easy: ["snare", "hihat", "pedalHat"],
  beginner: ["snare", "hihat", "pedalHat", "kick"],
  standard: ["snare", "hihat", "pedalHat", "kick", "floorTom", "crash", "ride"],
  hard: [
    "snare",
    "hihat",
    "pedalHat",
    "kick",
    "floorTom",
    "crash",
    "ride",
    "highTom",
    "midTom",
  ],
};

/** 踩镲与这些部件不可同刻出现（同刻时踩镲让位） */
const HIHAT_EXCLUSIVE: readonly PartId[] = ["floorTom", "crash", "ride"];


const BIG_VELOCITY = 108;

export interface MidiAnalysis {
  clean: CleanedMidi;
  skeleton: Skeleton;
}

export function analyzeMidi(midi: ParsedMidi, phaseBeatOffset = 0): MidiAnalysis {
  const clean = cleanMidi(midi, { phaseBeatOffset });
  return { clean, skeleton: buildSkeleton(clean) };
}

interface Emit {
  step: number;
  part: PartId;
  velocity: number;
  /** 踩镲为开镲（此刻左脚必须松开，长音符要断开） */
  open?: boolean;
}

/** 手部件（左右踏板之外的 7 件）：同一时刻最多同时出现 2 个 */
const HAND_PRIORITY: Partial<Record<PartId, number>> = {
  snare: 0,
  crash: 1,
  hihat: 2,
  ride: 2,
  highTom: 3,
  midTom: 4,
  floorTom: 5,
};
const MAX_HANDS_AT_ONCE = 2;

// ================= 入门 =================

function beginnerBar(bar: BarSkeleton, stepsPerBar: number, stepsPerBeat: number): Emit[] {
  const out: Emit[] = [];
  const beats = stepsPerBar / stepsPerBeat;

  if (bar.isFill) {
    // 过门小节：最后一拍用地通 2~3 下简单收尾
    const start = stepsPerBar - stepsPerBeat;
    const n = bar.noteCount >= 8 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      out.push({
        step: start + Math.round((k * stepsPerBeat) / n),
        part: "floorTom",
        velocity: 100,
      });
    }
    out.push({ step: 0, part: "kick", velocity: 110 });
    return out;
  }

  for (let b = 0; b < beats; b++) {
    const local = b * stepsPerBeat;
    // 军鼓：正拍（多在 2、4 拍）
    const s = hasNear(bar, "snare", local, stepsPerBeat / 2);
    if (s !== null) out.push({ step: local, part: "snare", velocity: bar.vel.snare?.[s] ?? 100 });
    // 底鼓：只允许正拍。原谱正拍上/紧邻有底鼓就落一下；
    // 只有切分底鼓（差半拍）时，仅在这一拍没有军鼓时才吸附过来，避免变成四踩。
    const exact = hasNear(bar, "kick", local, 1);
    const near = exact ?? (s === null ? hasNear(bar, "kick", local, stepsPerBeat / 2) : null);
    if (near !== null)
      out.push({ step: local, part: "kick", velocity: bar.vel.kick?.[near] ?? 100 });
  }

  // 偶尔的反拍军鼓：原谱在八分反拍有很强的军鼓时，每 4 小节最多保留一次
  if (bar.index % 4 === 3) {
    for (const s of bar.slots.snare ?? []) {
      if (s % stepsPerBeat === stepsPerBeat / 2 && (bar.vel.snare?.[s] ?? 0) >= 105) {
        out.push({ step: s, part: "snare", velocity: bar.vel.snare?.[s] ?? 105 });
        break;
      }
    }
  }

  // 踩镲：入门以「每拍一下」为主，只有原曲是连续 16 分的密集段才升到八分
  if (bar.hatDiv !== 0) {
    const div = bar.hatDiv === 16 ? stepsPerBeat / 2 : stepsPerBeat;
    for (let s = 0; s < stepsPerBar; s += div) out.push({ step: s, part: "hihat", velocity: 90 });
  }

  return out;
}

// ================= 标准 =================

function standardBar(bar: BarSkeleton, stepsPerBar: number, stepsPerBeat: number): Emit[] {
  const out: Emit[] = [];
  const cymbalPart: PartId = bar.ridePrimary ? "ride" : "hihat";

  if (bar.isFill) {
    // 过门小节不套模板：保留原始细节（量化后）并轻度简化
    for (const part of Object.keys(bar.slots) as PartId[]) {
      if (part === "hihat" && (bar.slots.hihat?.length ?? 0) > 4) continue;
      for (const s of bar.slots[part]!) {
        out.push({ step: s, part, velocity: bar.vel[part]?.[s] ?? 100 });
      }
    }
    return out;
  }

  const pattern = matchPattern(bar, stepsPerBar);
  if (!pattern) {
    for (const part of Object.keys(bar.slots) as PartId[]) {
      for (const s of bar.slots[part]!) {
        out.push({ step: s, part, velocity: bar.vel[part]?.[s] ?? 100 });
      }
    }
    return out;
  }

  for (const s of pattern.kick)
    out.push({ step: s, part: "kick", velocity: bar.vel.kick?.[s] ?? 105 });
  for (const s of pattern.snare)
    out.push({ step: s, part: "snare", velocity: bar.vel.snare?.[s] ?? 105 });

  const div = bar.hatDiv === 0 ? 0 : bar.hatDiv === 16 ? 1 : bar.hatDiv === 8 ? 2 : 4;
  const useDiv = div === 0 ? (pattern.hatDiv === 16 ? 1 : pattern.hatDiv === 8 ? 2 : 4) : div;
  if (bar.hatDiv !== 0) {
    for (let s = 0; s < stepsPerBar; s += useDiv) {
      const open = cymbalPart === "hihat" && bar.openHat.some((o) => Math.abs(o - s) <= 1);
      out.push({ step: s, part: cymbalPart, velocity: open ? 100 : 90, open });
    }
  }

  // 原曲的吊镲落点叠加回来（乐句首的重音）
  for (const s of bar.slots.crash ?? []) {
    out.push({ step: s, part: "crash", velocity: bar.vel.crash?.[s] ?? 110 });
  }
  // 原曲的踏板踩镲不再单独出音符：左脚改由「闭镲长音符」统一表示

  return out;
}

// ================= 困难 =================

const ALTERNATE: Partial<Record<PartId, PartId>> = {
  hihat: "ride",
  ride: "hihat",
  snare: "highTom",
  highTom: "snare",
  midTom: "highTom",
  floorTom: "midTom",
};

const TOM_DOWN: readonly PartId[] = ["highTom", "midTom", "floorTom"];

function hardEmits(clean: CleanedMidi, skeleton: Skeleton): Emit[] {
  const emits: Emit[] = clean.hits
    // 原曲的踏板踩镲交给闭镲长音符表示
    .filter((h: CleanHit) => h.part !== "pedalHat")
    .map((h: CleanHit) => ({
      step: h.step,
      part: h.part,
      velocity: h.velocity,
      open: h.open ?? false,
    }));

  // 1) 同一鼓件的快速连打拆成交替（间隔 ≤ 2 格、长度 ≥ 4）
  const byPart = new Map<PartId, Emit[]>();
  for (const e of emits) {
    const list = byPart.get(e.part) ?? [];
    list.push(e);
    byPart.set(e.part, list);
  }
  for (const [part, list] of byPart) {
    const partner = ALTERNATE[part];
    if (!partner) continue;
    list.sort((a, b) => a.step - b.step);
    let runStart = 0;
    for (let i = 1; i <= list.length; i++) {
      const broken = i === list.length || list[i]!.step - list[i - 1]!.step > 2;
      if (!broken) continue;
      const len = i - runStart;
      if (len >= 4) {
        for (let k = runStart + 1; k < i; k += 2) list[k]!.part = partner;
      }
      runStart = i;
    }
  }

  // 2) 过门小节的通鼓改成下行分配
  const fillBars = skeleton.bars.filter((b) => b.isFill);
  for (const bar of fillBars) {
    const inBar = emits
      .filter(
        (e) =>
          e.step >= bar.startStep &&
          e.step < bar.startStep + skeleton.stepsPerBar &&
          (e.part === "highTom" || e.part === "midTom" || e.part === "floorTom"),
      )
      .sort((a, b) => a.step - b.step);
    inBar.forEach((e, i) => {
      e.part =
        TOM_DOWN[
          Math.min(
            TOM_DOWN.length - 1,
            Math.floor((i * TOM_DOWN.length) / Math.max(1, inBar.length)),
          )
        ]!;
    });
  }

  return emits;
}

// ================= 组装 =================

/**
 * 物理限制：除左右踏板外，同一时刻手上最多只能打两个部件。
 * 超出的按优先级（军鼓 > 吊镲 > 踩镲/叮叮镲 > 高通 > 中通 > 地通）丢弃。
 */
function limitHands(emits: Emit[]): Emit[] {
  const byStep = new Map<number, Emit[]>();
  for (const e of emits) {
    const list = byStep.get(e.step) ?? [];
    list.push(e);
    byStep.set(e.step, list);
  }
  const out: Emit[] = [];
  for (const list of byStep.values()) {
    const hands = list.filter((e) => HAND_PRIORITY[e.part] !== undefined);
    const feet = list.filter((e) => HAND_PRIORITY[e.part] === undefined);
    out.push(...feet);
    if (hands.length <= MAX_HANDS_AT_ONCE) {
      out.push(...hands);
      continue;
    }
    hands.sort(
      (a, b) =>
        (HAND_PRIORITY[a.part] ?? 9) - (HAND_PRIORITY[b.part] ?? 9) || b.velocity - a.velocity,
    );
    out.push(...hands.slice(0, MAX_HANDS_AT_ONCE));
  }
  out.sort((a, b) => a.step - b.step);
  return out;
}

interface HoldSeg {
  startStep: number;
  endStep: number;
}

/**
 * 闭镲期间左脚要一直踩住：把连续的闭镲段落转成左踏板长音符。
 * 开镲处断开，开镲之后再出现闭镲则重新踩下。
 */
function pedalHolds(
  emits: Emit[],
  diff: Difficulty,
  stepsPerBar: number,
  stepsPerBeat: number,
): HoldSeg[] {
  const hats = emits.filter((e) => e.part === "hihat").sort((a, b) => a.step - b.step);
  if (hats.length === 0) return [];
  // 入门：全部按闭镲处理
  const isOpen = (e: Emit) => diff !== "beginner" && e.open === true;
  const minLen = diff === "beginner" ? stepsPerBar : stepsPerBeat * 2;
  const gapLimit = stepsPerBar;
  /** 单条长音符最长 4 小节：太长的连续踩住在游玩上没有意义，乐句间换脚 */
  const maxLen = stepsPerBar * 4;

  const segs: HoldSeg[] = [];
  let cur: HoldSeg | null = null;
  const flush = (endStep: number) => {
    if (cur && endStep - cur.startStep >= minLen) segs.push({ ...cur, endStep });
    cur = null;
  };
  for (const e of hats) {
    if (isOpen(e)) {
      // 开镲前一格松脚
      if (cur) flush(Math.max(cur.startStep, e.step - 1));
      continue;
    }
    if (!cur) cur = { startStep: e.step, endStep: e.step };
    else if (e.step - cur.endStep > gapLimit || e.step - cur.startStep >= maxLen) {
      const prevEnd = cur.endStep + 1;
      flush(prevEnd);
      cur = { startStep: e.step, endStep: e.step };
    } else cur.endStep = e.step;
  }
  if (cur) flush((cur as HoldSeg).endStep + 1);
  return segs;
}

function emitsToNotes(
  emits: Emit[],
  midi: ParsedMidi,
  clean: CleanedMidi,
  layout: LayoutMode,
  offsetMs: number,
): TaikoNote[] {
  const allow = new Set(VISIBLE_PARTS[layout]);
  const seen = new Set<string>();
  const notes: TaikoNote[] = [];
  for (const e of emits) {
    if (!allow.has(e.part)) continue;
    const key = `${e.step}:${e.part}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const timeMs = tickToMs(midi, e.step * clean.stepTicks) + offsetMs;
    if (timeMs < 0) continue;
    notes.push({
      timeMs,
      lane: e.part === "kick" || e.part === "pedalHat" ? "don" : "ka",
      big: e.velocity >= BIG_VELOCITY,
      note: noteForPart(e.part),
    });
  }
  notes.sort((a, b) => a.timeMs - b.timeMs);
  return notes;
}

function holdsToNotes(
  segs: HoldSeg[],
  midi: ParsedMidi,
  clean: CleanedMidi,
  layout: LayoutMode,
  offsetMs: number,
): TaikoNote[] {
  if (!VISIBLE_PARTS[layout].includes("pedalHat")) return [];
  const notes: TaikoNote[] = [];
  for (const s of segs) {
    const startMs = tickToMs(midi, s.startStep * clean.stepTicks) + offsetMs;
    const endMs = tickToMs(midi, s.endStep * clean.stepTicks) + offsetMs;
    if (startMs < 0 || endMs <= startMs) continue;
    notes.push({
      timeMs: startMs,
      lane: "don",
      note: noteForPart("pedalHat"),
      holdMs: Math.round(endMs - startMs),
    });
  }
  return notes;
}

export interface PlayChartOptions extends MidiChartOptions {
  /** 小节相位手动微调（拍） */
  phaseBeatOffset?: number | undefined;
}

/** MIDI → 按难度成谱（谱面屏与游玩屏共用） */
export function buildPlayChart(
  midi: ParsedMidi,
  opts: PlayChartOptions,
  diff: Difficulty,
): TaikoChart {
  const { clean, skeleton } = analyzeMidi(midi, opts.phaseBeatOffset ?? 0);
  const offset = opts.offsetMs ?? 0;
  const layout = layoutOf(diff);

  let emits: Emit[];
  if (diff === "hard") {
    emits = hardEmits(clean, skeleton);
  } else {
    emits = [];
    for (const bar of skeleton.bars) {
      const local =
        diff === "beginner"
          ? beginnerBar(bar, skeleton.stepsPerBar, skeleton.stepsPerBeat)
          : standardBar(bar, skeleton.stepsPerBar, skeleton.stepsPerBeat);
      for (const e of local) emits.push({ ...e, step: bar.startStep + e.step });
    }
  }

  emits = limitHands(emits);
  // 暂时停用左踏板长音符（代码保留，恢复时改回调用 pedalHolds 即可）
  const holds: HoldSeg[] = [];

  const notes = [
    ...emitsToNotes(emits, midi, clean, layout, offset),
    ...holdsToNotes(holds, midi, clean, layout, offset),
  ].sort((a, b) => a.timeMs - b.timeMs);
  const last = notes[notes.length - 1]?.timeMs ?? 0;
  return {
    title: opts.title,
    bpm: Math.round(midi.bpm * 100) / 100,
    timeSignature: midi.timeSignature,
    durationMs: opts.durationMs ?? Math.max(last + 2000, midi.durationMs + offset),
    notes,
  };
}

/** 兼容旧接口：按难度加工已有谱面（现只用于渲染层测试） */
export function applyDifficulty(chart: TaikoChart, diff: Difficulty): TaikoChart {
  const allow = new Set(VISIBLE_PARTS[layoutOf(diff)]);
  const noteToPart = new Map<number, PartId>();
  for (const p of VISIBLE_PARTS.nine) noteToPart.set(noteForPart(p), p);
  return {
    ...chart,
    notes: chart.notes.filter((n) => {
      const p = n.note !== undefined ? noteToPart.get(n.note) : undefined;
      return p !== undefined && allow.has(p);
    }),
  };
}
