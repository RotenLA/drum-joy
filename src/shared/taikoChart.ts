import { getDrumLane, type DrumLane } from "./drumLaneMap";

export interface TaikoNote {
  /** 相对曲目起点的毫秒时间 */
  timeMs: number;
  lane: DrumLane;
  /** 重击（大音符），后续判定用，本轮仅渲染 */
  big?: boolean;
  /** 原始 MIDI 音符号（下落式分区渲染需要） */
  note?: number;
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
    measures[idx]?.push(note);
  }
  return measures;
}

/** 演示用假谱面：4/4、140 BPM、16 小节，使用真实 GM 鼓件音符 */
export function createDemoChart(): TaikoChart {
  const bpm = 140;
  const beatMs = 60000 / bpm;
  const measures = 16;
  const notes: TaikoNote[] = [];
  const push = (timeMs: number, note: number, big = false) => {
    const lane = getDrumLane(note);
    if (!lane) return;
    notes.push({ timeMs, lane, note, big });
  };

  for (let m = 0; m < measures; m++) {
    for (let b = 0; b < 4; b++) {
      const base = (m * 4 + b) * beatMs;
      if (b === 0 || b === 2) push(base, 36); // 底鼓：1、3 拍
      if (b === 1 || b === 3) push(base, 38); // 军鼓：2、4 拍
      if (b === 0 && m % 4 === 0) push(base, 49, true); // 每 4 小节吊镲重击
      // 8 分踩镲，每 4 小节末拍开镲
      push(base + beatMs / 2, m % 4 === 3 && b === 3 ? 46 : 42);
      // 奇数小节反拍叮叮镲
      if (m % 2 === 1 && (b === 1 || b === 3)) push(base + beatMs / 2, 51);
    }
  }

  // 末小节通鼓加花：高通 → 中通 → 低通 → 地通
  const fill = (measures - 1) * 4 * beatMs;
  [50, 47, 45, 41].forEach((n, i) => push(fill + i * beatMs + beatMs / 2, n));

  notes.sort((a, b) => a.timeMs - b.timeMs);
  return {
    title: "Neon Demo",
    bpm,
    timeSignature: [4, 4],
    durationMs: measures * 4 * beatMs,
    notes,
  };
}
