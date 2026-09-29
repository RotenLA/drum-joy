/**
 * 四档难度均从原始 GM 鼓 MIDI 筛选；量化网格只参与结构分析和限密度，
 * 网格来自上传 MIDI 的 tick 与 tempo map；轻松/入门稳定吸附，标准/困难只修正小偏差。
 */
import type { TaikoChart, TaikoNote } from "@/shared/taikoChart";
import { VISIBLE_PARTS, type LayoutMode, type PartId } from "./laneLayouts";
import { noteForPart, type MidiChartOptions } from "./midiChart";
import { tickToMs, type ParsedMidi } from "./midiFile";
import { cleanMidi, type CleanedMidi, type CleanHit } from "./midiClean";
import { buildSkeleton, type Skeleton } from "./skeleton";

export type Difficulty = "easy" | "beginner" | "standard" | "hard";

export const DIFFICULTIES: readonly {
  id: Difficulty;
  label: string;
  labelEn: string;
  hint: string;
  hintEn: string;
}[] = [
  {
    id: "easy",
    label: "轻松",
    labelEn: "Easy",
    hint: "军鼓 · 踩镲 · 左踏板踩住",
    hintEn: "Snare · hi-hat · left pedal held",
  },
  {
    id: "beginner",
    label: "入门",
    labelEn: "Beginner",
    hint: "轻松 + 右踏板",
    hintEn: "Easy + right pedal",
  },
  {
    id: "standard",
    label: "标准",
    labelEn: "Standard",
    hint: "加入低通 / 吊镲 / 叮叮镲",
    hintEn: "Adds floor tom / crash / ride",
  },
  {
    id: "hard",
    label: "困难",
    labelEn: "Hard",
    hint: "全部鼓件，含高通 / 中通",
    hintEn: "All nine pieces, incl. high / mid tom",
  },
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
  hard: ["snare", "hihat", "pedalHat", "kick", "floorTom", "crash", "ride", "highTom", "midTom"],
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
  /** 原始 MIDI note-on 时间；最终按难度决定保留或吸附到 tempo map 网格。 */
  timeMs?: number;
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
      timeMs: h.timeMs,
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

  // 3) 非过门通鼓优先保留强拍和强音，避免机械地“每三个留一个”。
  const fillRanges = fillBars.map((b) => [b.startStep, b.startStep + skeleton.stepsPerBar]);
  const inFill = (step: number) => fillRanges.some(([a, b]) => step >= a! && step < b!);
  const kept: Emit[] = [];
  for (const e of emits.slice().sort((a, b) => a.step - b.step)) {
    if ((e.part === "highTom" || e.part === "midTom") && !inFill(e.step)) {
      const local = ((e.step - skeleton.phaseSteps) % skeleton.stepsPerBar + skeleton.stepsPerBar) % skeleton.stepsPerBar;
      const accented = local % skeleton.stepsPerBeat === 0 || e.velocity >= BIG_VELOCITY;
      if (!accented) continue;
    }
    kept.push(e);
  }

  return kept;
}

/**
 * 轻松 / 入门 / 标准都从原始 GM 命中筛选，不再套固定军鼓模板。
 * 难度只决定保留哪些部件与密度，保留下来的音符始终携带原 MIDI 时间。
 */
function sourceEmits(clean: CleanedMidi, diff: Difficulty): Emit[] {
  const allowed = new Set(NOTE_PARTS[diff]);
  const hits = clean.hits.filter((hit) => allowed.has(hit.part));
  if (diff === "standard") {
    return hits.map((hit) => {
      const emit: Emit = { step: hit.step, part: hit.part, velocity: hit.velocity, timeMs: hit.timeMs };
      if (hit.open !== undefined) emit.open = hit.open;
      return emit;
    });
  }

  // 轻松只保留整拍，不出现八分/十六分切分；入门以整拍和八分为主，
  // 十六分位置仅保留非常明确的重音。这里只筛选，最终时间仍取原 MIDI timeMs。
  const selected = hits.filter((hit) => {
    const local = ((hit.step - clean.phaseSteps) % clean.stepsPerBeat + clean.stepsPerBeat) % clean.stepsPerBeat;
    if (diff === "easy") return local === 0;
    const onEighth = local % 2 === 0;
    return onEighth || hit.velocity >= 112;
  });
  return selected.map((hit) => {
    const emit: Emit = { step: hit.step, part: hit.part, velocity: hit.velocity, timeMs: hit.timeMs };
    if (hit.part === "hihat") emit.open = false;
    return emit;
  });
}

/** 踩镲与低通/吊镲/叮叮镲不可同刻：同刻时丢掉踩镲 */
function excludeHihatClashes(emits: Emit[]): Emit[] {
  const clash = new Set<number>();
  for (const e of emits) {
    if (HIHAT_EXCLUSIVE.includes(e.part)) clash.add(e.step);
  }
  return emits.filter((e) => !(e.part === "hihat" && clash.has(e.step)));
}

const DENSITY_LIMIT: Record<Difficulty, number> = {
  easy: 2.5,
  beginner: 3.4,
  standard: 6.5,
  hard: 9,
};

/** 一秒滑窗限密度：保留脚、强拍与强音，优先移除弱的连续手击。 */
function limitDensity(emits: Emit[], diff: Difficulty, clean: CleanedMidi): Emit[] {
  const limit = Math.ceil(DENSITY_LIMIT[diff]);
  const sorted = emits.slice().sort((a, b) => a.step - b.step || b.velocity - a.velocity);
  const kept: Emit[] = [];
  const importance = (emit: Emit) => {
    const local = ((emit.step - clean.phaseSteps) % clean.stepsPerBar + clean.stepsPerBar) % clean.stepsPerBar;
    const onBeat = local % clean.stepsPerBeat === 0;
    const foot = emit.part === "kick" || emit.part === "pedalHat";
    return (foot ? 80 : 0) + (onBeat ? 60 : 0) + emit.velocity;
  };
  for (const e of sorted) {
    const atMs = tickToMs(clean.sourceMidi, e.step * clean.stepTicks);
    const recent = kept.filter((item) => {
      const itemMs = tickToMs(clean.sourceMidi, item.step * clean.stepTicks);
      return itemMs > atMs - 1000 && itemMs <= atMs;
    });
    if (recent.length < limit) {
      kept.push(e);
      continue;
    }
    const weakest = recent.reduce((candidate, item) => importance(item) < importance(candidate) ? item : candidate);
    if (importance(e) > importance(weakest)) {
      const index = kept.indexOf(weakest);
      if (index >= 0) kept.splice(index, 1, e);
    }
  }
  return kept.sort((a, b) => a.step - b.step || b.velocity - a.velocity);
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
 * 左踏板：整曲踩住。
 * 轻松 / 入门 → 第一个闭镲踩下后一直踩到结束，只有一条长音符；
 * 标准 / 困难 → 开镲处松开断开，开镲之后重新踩下。
 */
function pedalHolds(emits: Emit[], diff: Difficulty, endStep: number): HoldSeg[] {
  const hats = emits.filter((e) => e.part === "hihat").sort((a, b) => a.step - b.step);
  const first = hats[0];
  if (!first) return [];
  const alwaysClosed = diff === "easy" || diff === "beginner";
  if (alwaysClosed) {
    return endStep > first.step ? [{ startStep: first.step, endStep }] : [];
  }

  const opens = hats.filter((e) => e.open === true).map((e) => e.step);
  const segs: HoldSeg[] = [];
  let start = first.step;
  for (const o of opens) {
    if (o - 1 > start) segs.push({ startStep: start, endStep: o - 1 });
    // 开镲之后的下一个闭镲重新踩下
    const next = hats.find((e) => e.step > o && e.open !== true);
    if (!next) return segs;
    start = next.step;
  }
  if (endStep > start) segs.push({ startStep: start, endStep });
  return segs;
}

function emitsToNotes(
  emits: Emit[],
  midi: ParsedMidi,
  clean: CleanedMidi,
  allowParts: readonly PartId[],
  offsetMs: number,
  diff: Difficulty,
): TaikoNote[] {
  const allow = new Set(allowParts);
  const seen = new Set<string>();
  const notes: TaikoNote[] = [];
  for (const e of emits) {
    if (!allow.has(e.part)) continue;
    const key = `${e.step}:${e.part}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const gridTimeMs = tickToMs(midi, e.step * clean.stepTicks);
    const sourceTimeMs = e.timeMs ?? gridTimeMs;
    const forceGrid = diff === "easy" || diff === "beginner";
    const snapSmallDeviation = Math.abs(sourceTimeMs - gridTimeMs) <= 35;
    const timeMs = (forceGrid || snapSmallDeviation ? gridTimeMs : sourceTimeMs) + offsetMs;
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
  offsetMs: number,
): TaikoNote[] {
  const notes: TaikoNote[] = [];
  for (const s of segs) {
    // 相位微调可能让首个闭镲落在 0 之前，长音符起点夹到曲首
    const startStep = Math.max(0, s.startStep);
    const startMs = Math.max(0, tickToMs(midi, startStep * clean.stepTicks) + offsetMs);
    const endMs = tickToMs(midi, s.endStep * clean.stepTicks) + offsetMs;
    if (endMs <= startMs) continue;

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

  let emits: Emit[];
  emits = diff === "hard" ? hardEmits(clean, skeleton) : sourceEmits(clean, diff);

  // 轻松 / 入门：全部按闭镲处理（不出开镲）
  if (diff === "easy" || diff === "beginner") {
    for (const e of emits) e.open = false;
  }
  emits = limitDensity(excludeHihatClashes(limitHands(emits)), diff, clean);

  const lastStep = emits.reduce((m, e) => Math.max(m, e.step), 0);
  const holds = pedalHolds(emits, diff, lastStep + skeleton.stepsPerBeat);

  const notes = [
    ...emitsToNotes(emits, midi, clean, NOTE_PARTS[diff], offset, diff),
    ...holdsToNotes(holds, midi, clean, offset),
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
