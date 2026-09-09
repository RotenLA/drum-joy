/**
 * 鼓 MIDI → 谱面（TaikoChart）。
 * GM 打击乐音符归并到 9 个部件；力度高的标记为重击；
 * 时间来自 MIDI tempo map（支持变速），可整体加偏移对齐音频。
 */
import type { TaikoChart, TaikoNote } from "@/shared/taikoChart";
import { PART_BY_ID, getMapping, type PartId } from "./laneLayouts";
import type { ParsedMidi } from "./midiFile";

/** GM 打击乐 → 部件（未列出的音符忽略） */
export const GM_TO_PART: Readonly<Record<number, PartId>> = {
  35: "kick",
  36: "kick",
  37: "snare", // 边击
  38: "snare",
  39: "snare", // 拍手
  40: "snare",
  41: "floorTom",
  42: "hihat",
  43: "floorTom",
  44: "pedalHat",
  45: "floorTom",
  46: "hihat",
  47: "midTom",
  48: "highTom",
  49: "crash",
  50: "highTom",
  51: "ride",
  52: "crash",
  53: "ride", // ride bell
  55: "crash", // splash
  57: "crash",
  59: "ride",
};

/** 开镲（左脚松开时敲的踩镲）音符；其余踩镲音符视为闭镲 */
export const OPEN_HAT_NOTES: ReadonlySet<number> = new Set([46, 26]);

/** 部件 → 当前映射里的代表音符（供判定时 partOfNote 反查） */
export function noteForPart(part: PartId): number {
  const mapped = getMapping()[part];
  return mapped?.[0] ?? PART_BY_ID[part].notes[0] ?? 36;
}

/** 力度阈值以上视为重击 */
const BIG_VELOCITY = 108;

export interface MidiChartOptions {
  title: string;
  /** 整体偏移（毫秒，音频与 MIDI 起点对不齐时用） */
  offsetMs?: number | undefined;
  /** 曲目总长（毫秒）；不给则用 MIDI 自身长度 */
  durationMs?: number | undefined;
}

export function buildChartFromMidi(midi: ParsedMidi, opts: MidiChartOptions): TaikoChart {
  const offset = opts.offsetMs ?? 0;
  const notes: TaikoNote[] = [];
  for (const ev of midi.notes) {
    const part = GM_TO_PART[ev.note];
    if (!part) continue;
    const timeMs = ev.timeMs + offset;
    if (timeMs < 0) continue;
    notes.push({
      timeMs,
      lane: part === "kick" || part === "pedalHat" ? "don" : "ka",
      big: ev.velocity >= BIG_VELOCITY,
      note: noteForPart(part),
    });
  }
  notes.sort((a, b) => a.timeMs - b.timeMs);
  const last = notes[notes.length - 1]?.timeMs ?? 0;
  return {
    title: opts.title,
    bpm: Math.round(midi.bpm * 100) / 100,
    timeSignature: midi.timeSignature,
    durationMs: opts.durationMs ?? Math.max(last + 2000, midi.durationMs + offset),
    notes,
  };
}

/** 谱面里各部件的音符数（谱面屏预览用） */
export function countByPart(chart: TaikoChart): Record<PartId, number> {
  const counts = {} as Record<PartId, number>;
  for (const p of Object.keys(PART_BY_ID) as PartId[]) counts[p] = 0;
  const noteToPart = new Map<number, PartId>();
  for (const p of Object.keys(PART_BY_ID) as PartId[]) noteToPart.set(noteForPart(p), p);
  for (const n of chart.notes) {
    const p = n.note !== undefined ? noteToPart.get(n.note) : undefined;
    if (p) counts[p]++;
  }
  return counts;
}
