import type { DrumLane } from "./drumLaneMap";

export interface TaikoNote {
  /** 相对曲目起点的毫秒时间 */
  timeMs: number;
  lane: DrumLane;
  /** 重击（大音符），后续判定用，本轮仅渲染 */
  big?: boolean;
  /** 原始 MIDI 音符号（下落式分区渲染需要） */
  note?: number;
  /** 长音符时长（毫秒）；用于左踏板「踩住闭镲」这类需要全程按住的音符 */
  holdMs?: number;
}

export interface TaikoChart {
  title: string;
  bpm: number;
  /** [分子, 分母]，如 [4, 4] */
  timeSignature: [number, number];
  /** 曲目总长（毫秒） */
  durationMs: number;
  notes: TaikoNote[];
}

/** 一小节的毫秒长度 */
export function measureDurationMs(chart: TaikoChart): number {
  const [num, den] = chart.timeSignature;
  return (60000 / chart.bpm) * num * (4 / den);
}

/**
 * 按小节切分音符。
 * offsetMs 为首拍偏移（自动检测给出）：小节 i 覆盖
 * [offsetMs + i*len, offsetMs + (i+1)*len)。
 */
export function splitByMeasure(chart: TaikoChart, offsetMs = 0): TaikoNote[][] {
  const len = measureDurationMs(chart);
  const count = Math.max(1, Math.ceil((chart.durationMs - offsetMs) / len));
  const measures: TaikoNote[][] = Array.from({ length: count }, () => []);
  for (const note of chart.notes) {
    const idx = Math.min(
      count - 1,
      Math.max(0, Math.floor((note.timeMs - offsetMs) / len)),
    );
    measures[idx]?.push(note);
  }
  return measures;
}
