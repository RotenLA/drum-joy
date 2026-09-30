/**
 * 四档难度由基础鼓节奏型生成：MIDI 只作对位参考（小节网格、疏密、重音、过门）。
 *
 * 计时基准的优先级：
 * 1) Metro（节拍器）轨解析出的绝对节拍时间轴 —— 逐拍真实时刻，动态变速也精准；
 * 2) 没有 Metro 轨的旧歌才回退到 MIDI tempo map + 真实击打回填。
 */
import type { ChartBeatMap, TaikoChart, TaikoNote } from "@/shared/taikoChart";
import { VISIBLE_PARTS, type LayoutMode, type PartId } from "./laneLayouts";
import { noteForPart, type MidiChartOptions } from "./midiChart";
import { tickToMs, type ParsedMidi } from "./midiFile";
import { cleanMidi, type CleanedMidi } from "./midiClean";
import { buildSkeleton, type Skeleton } from "./skeleton";
import { patternEmits } from "./patterns";
import { averageBeatMs, beatTimeAt } from "./beatGrid";


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

/** 踩镲与低通/吊镲/叮叮镲不可同刻：同刻时丢掉踩镲 */
function excludeHihatClashes(emits: Emit[]): Emit[] {
  const clash = new Set<number>();
  for (const e of emits) {
    if (HIHAT_EXCLUSIVE.includes(e.part)) clash.add(e.step);
  }
  return emits.filter((e) => !(e.part === "hihat" && clash.has(e.step)));
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

/**
 * 真实打击时间对齐。
 *
 * 谱面音符的位置来自量化网格，但时间优先回填原 MIDI 的真实 note-on 毫秒。
 * 关键：同一格（同一拍位）上的所有部件共用一个锚点时刻，绝不各自漂移，
 * 否则本该同时响的踩镲与军鼓会被拉开几十毫秒，听感变成突兀的 32 分连击。
 *
 * 锚点取法：
 * 1) 本格内真实击打（按军鼓 > 底鼓 > 踩镲 > 其他的主次顺序）；
 * 2) 相邻 ±1 格的真实击打；
 * 3) 低难度补出来的音符 → 小节内前后真实击打做局部线性插值；
 * 4) 都没有 → 退回 tempo map 网格时间。
 * 任何一步与网格偏差超过阈值时一律回退网格，避免跟着脏音符跑偏。
 */
const ANCHOR_PRIORITY: readonly PartId[] = ["snare", "kick", "hihat", "ride", "crash"];

class HitAligner {
  private byPartStep = new Map<string, number>();
  private byStep = new Map<number, number>();
  private steps: number[] = [];
  /** 每格一个锚点时刻，保证同刻音符严格同时 */
  private anchors = new Map<number, number>();

  constructor(
    private midi: ParsedMidi,
    private clean: CleanedMidi,
  ) {
    for (const h of clean.hits) {
      const key = `${h.step}:${h.part}`;
      const prev = this.byPartStep.get(key);
      if (prev === undefined || h.timeMs < prev) this.byPartStep.set(key, h.timeMs);
      const at = this.byStep.get(h.step);
      if (at === undefined || h.timeMs < at) this.byStep.set(h.step, h.timeMs);
    }
    this.steps = [...this.byStep.keys()].sort((a, b) => a - b);
  }

  private grid(step: number): number {
    return tickToMs(this.midi, step * this.clean.stepTicks);
  }

  /** 一格的毫秒长度（按该处 tempo 估算） */
  private stepMs(step: number): number {
    const a = this.grid(step);
    const b = this.grid(step + 1);
    return Math.max(1, b - a);
  }

  private interpolate(step: number): number | null {
    const bar = this.clean.stepsPerBar;
    let lo: number | null = null;
    let hi: number | null = null;
    for (const s of this.steps) {
      if (s <= step) lo = s;
      else {
        hi = s;
        break;
      }
    }
    if (lo === null || hi === null || hi === lo) return null;
    if (step - lo > bar || hi - step > bar) return null;
    const a = this.byStep.get(lo)!;
    const b = this.byStep.get(hi)!;
    return a + ((b - a) * (step - lo)) / (hi - lo);
  }

  /** 该格的统一锚点时刻（与部件无关） */
  timeOf(step: number, _part?: PartId): number {
    const cached = this.anchors.get(step);
    if (cached !== undefined) return cached;

    const grid = this.grid(step);
    const tol = this.stepMs(step) * 1.5;
    const accept = (t: number | undefined | null) =>
      t !== undefined && t !== null && Math.abs(t - grid) <= tol ? t : null;

    let at: number | null = null;
    // 本格主次部件 → 本格任意部件 → 相邻格主次部件
    for (const p of ANCHOR_PRIORITY) {
      at = accept(this.byPartStep.get(`${step}:${p}`));
      if (at !== null) break;
    }
    at ??= accept(this.byStep.get(step));
    if (at === null) {
      for (const p of ANCHOR_PRIORITY) {
        at =
          accept(this.byPartStep.get(`${step - 1}:${p}`)) ??
          accept(this.byPartStep.get(`${step + 1}:${p}`));
        if (at !== null) break;
      }
    }
    at ??= accept(this.interpolate(step));

    const time = at ?? grid;
    this.anchors.set(step, time);
    return time;
  }
}

/** 各难度允许的最小音符间隔（毫秒）：小于这个间隔的两批音符合并到同一时刻 */
const MIN_GAP_MS: Record<Difficulty, number> = {
  easy: 180,
  beginner: 110,
  standard: 70,
  hard: 45,
};

/**
 * 物理最小间隔门限：把靠得过近的两批音符收拢到同一时刻，
 * 彻底杜绝轻松/入门出现听感上的 32 分碎音。
 */
function enforceMinGap(notes: TaikoNote[], diff: Difficulty): TaikoNote[] {
  const gap = MIN_GAP_MS[diff];
  let anchor = -Infinity;
  for (const n of notes) {
    if (n.timeMs - anchor < gap) {
      const shift = anchor - n.timeMs;
      n.timeMs = anchor;
      if (n.holdMs !== undefined) n.holdMs = Math.max(1, n.holdMs - shift);
    } else {
      anchor = n.timeMs;
    }
  }
  return notes;
}


function emitsToNotes(
  emits: Emit[],
  midi: ParsedMidi,
  clean: CleanedMidi,
  allowParts: readonly PartId[],
  offsetMs: number,
  aligner: HitAligner,
): TaikoNote[] {
  const allow = new Set(allowParts);
  const seen = new Set<string>();
  const notes: TaikoNote[] = [];
  for (const e of emits) {
    if (!allow.has(e.part)) continue;
    const key = `${e.step}:${e.part}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const timeMs = aligner.timeOf(e.step, e.part) + offsetMs;
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
  aligner: HitAligner,
): TaikoNote[] {
  const notes: TaikoNote[] = [];
  for (const s of segs) {
    // 相位微调可能让首个闭镲落在 0 之前，长音符起点夹到曲首
    const startStep = Math.max(0, s.startStep);
    const startMs = Math.max(0, aligner.timeOf(startStep, "pedalHat") + offsetMs);

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

  let emits: Emit[] = patternEmits(skeleton, diff, midi.timeSignature[0]);

  // 轻松 / 入门：全部按闭镲处理（不出开镲）
  if (diff === "easy" || diff === "beginner") {
    for (const e of emits) e.open = false;
  }
  emits = excludeHihatClashes(limitHands(emits));

  const lastStep = emits.reduce((m, e) => Math.max(m, e.step), 0);
  const holds = pedalHolds(emits, diff, lastStep + skeleton.stepsPerBeat);

  const aligner = new HitAligner(midi, clean);
  const notes = enforceMinGap(
    [
      ...emitsToNotes(emits, midi, clean, NOTE_PARTS[diff], offset, aligner),
      ...holdsToNotes(holds, midi, clean, offset, aligner),
    ].sort((a, b) => a.timeMs - b.timeMs),
    diff,
  );



  const last = notes[notes.length - 1]?.timeMs ?? 0;
  // 节拍栅格：与音符完全同源（同一 tempo map、同一相位、同一 offset）
  const phaseSteps = skeleton.phaseSteps;
  const gridAt = (step: number) => tickToMs(midi, step * clean.stepTicks) + offset;
  const originMs = gridAt(phaseSteps);
  const stepMs = Math.max(1, (gridAt(phaseSteps + 4) - originMs) / 4);
  return {
    title: opts.title,
    bpm: Math.round(midi.bpm * 100) / 100,
    timeSignature: midi.timeSignature,
    durationMs: opts.durationMs ?? Math.max(last + 2000, midi.durationMs + offset),
    notes,
    grid: {
      originMs,
      stepMs,
      stepsPerBeat: clean.stepsPerBeat,
      stepsPerBar: clean.stepsPerBar,
    },
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
