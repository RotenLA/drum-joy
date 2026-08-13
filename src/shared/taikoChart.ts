import type { DrumLane } from "./drumLaneMap";

export interface TaikoNote {
  /** 相对曲目起点的毫秒时间 */
  timeMs: number;
  lane: DrumLane;
  /** 重击（大音符），后续判定用，本轮仅渲染 */
  big?: boolean;
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

/** 按小节切分音符 */
export function splitByMeasure(chart: TaikoChart): TaikoNote[][] {
  const len = measureDurationMs(chart);
  const count = Math.max(1, Math.ceil(chart.durationMs / len));
  const measures: TaikoNote[][] = Array.from({ length: count }, () => []);
  for (const note of chart.notes) {
    const idx = Math.min(count - 1, Math.floor(note.timeMs / len));
    measures[idx].push(note);
  }
  return measures;
}

/** 演示用假谱面：4/4、140 BPM、16 小节 */
export function createDemoChart(): TaikoChart {
  const bpm = 140;
  const beatMs = 60000 / bpm;
  const notes: TaikoNote[] = [];
  const measures = 16;
  for (let m = 0; m < measures; m++) {
    for (let b = 0; b < 4; b++) {
      const base = (m * 4 + b) * beatMs;
      const isDon = b % 2 === 0;
      notes.push({ timeMs: base, lane: isDon ? "don" : "ka", big: b === 0 && m % 4 === 3 });
      if (m % 2 === 1 && b % 2 === 1) {
        notes.push({ timeMs: base + beatMs / 2, lane: "ka" });
      }
    }
  }
  return {
    title: "Demo Pattern",
    bpm,
    timeSignature: [4, 4],
    durationMs: measures * 4 * beatMs,
    notes,
  };
}
