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

/**
 * 节拍网格：谱面音符所用的同一套栅格。
 * 渲染层的节拍刻度必须用它，否则会和音符/音乐错相位。
 */
export interface ChartGrid {
  /** 第一小节第一拍的时刻（毫秒，与 notes 同一时间基准） */
  originMs: number;
  /** 一格（十六分）的毫秒长度 */
  stepMs: number;
  /** 一拍几格 */
  stepsPerBeat: number;
  /** 一小节几格 */
  stepsPerBar: number;
}

/**
 * Metro（节拍器）轨解析出的绝对节拍时间轴。
 * 每一项是那一拍的真实毫秒时刻，所以动态变速的真人演奏也能逐拍贴合；
 * 有它时音符与节拍刻度全部以它为唯一基准，不再用 BPM 反推。
 */
export interface ChartBeatMap {
  /** 每一拍的毫秒时刻（升序，与 notes 同一时间基准） */
  beats: number[];
  /** 小节拍数 */
  beatsPerBar: number;
  /** 首个重拍在 beats 里的相位下标 */
  barPhase: number;
}

export interface TaikoChart {
  title: string;
  bpm: number;
  /** [分子, 分母]，如 [4, 4] */
  timeSignature: [number, number];
  /** 曲目总长（毫秒） */
  durationMs: number;
  notes: TaikoNote[];
  /** 节拍栅格（新谱面必带；旧谱面缺省时渲染层回退估算） */
  grid?: ChartGrid;
  /** Metro 轨绝对节拍轴（有则优先于 grid，支持动态变速） */
  beatMap?: ChartBeatMap;
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

/**
 * 整体平移谱面时间（毫秒，正数=提前）。
 * 用于切掉音频开头空白后，让 MIDI 谱面与音轨保持同步。
 * 平移到 0 之前的音符会被丢弃（长音符按剩余部分保留）。
 */
export function shiftChart(chart: TaikoChart, shiftMs: number): TaikoChart {
  if (!shiftMs) return chart;
  const notes: TaikoNote[] = [];
  for (const n of chart.notes) {
    const t = n.timeMs - shiftMs;
    const hold = n.holdMs ?? 0;
    if (t < 0) {
      if (hold <= 0 || t + hold <= 0) continue;
      notes.push({ ...n, timeMs: 0, holdMs: t + hold });
      continue;
    }
    notes.push({ ...n, timeMs: t });
  }
  const grid = chart.grid ? { ...chart.grid, originMs: chart.grid.originMs - shiftMs } : undefined;
  const beatMap = chart.beatMap
    ? { ...chart.beatMap, beats: chart.beatMap.beats.map((t) => t - shiftMs) }
    : undefined;
  return {
    ...chart,
    durationMs: Math.max(0, chart.durationMs - shiftMs),
    notes,
    ...(grid ? { grid } : {}),
    ...(beatMap ? { beatMap } : {}),
  };
}

