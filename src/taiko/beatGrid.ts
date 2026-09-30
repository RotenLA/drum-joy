/**
 * 节拍时间轴查询：把「第几拍（可带小数）」换成真实毫秒。
 *
 * beats 来自 Metro 轨，间隔随真人演奏起伏，所以拍与拍之间必须线性插值，
 * 绝不能用「首拍 + 拍号 × 平均拍长」——那样变速曲越往后偏得越多。
 */
import type { ChartBeatMap } from "@/shared/taikoChart";

/** beatFloat → 毫秒；超出两端时按最近的一段拍长线性外推 */
export function beatTimeAt(beats: readonly number[], beatFloat: number): number {
  const n = beats.length;
  if (n === 0) return 0;
  if (n === 1) return beats[0]!;
  if (beatFloat <= 0) {
    const step = beats[1]! - beats[0]!;
    return beats[0]! + step * beatFloat;
  }
  if (beatFloat >= n - 1) {
    const step = beats[n - 1]! - beats[n - 2]!;
    return beats[n - 1]! + step * (beatFloat - (n - 1));
  }
  const i = Math.floor(beatFloat);
  const frac = beatFloat - i;
  const a = beats[i]!;
  const b = beats[i + 1]!;
  return a + (b - a) * frac;
}

/** 该拍是否小节重拍 */
export function isDownbeat(map: ChartBeatMap, index: number): boolean {
  const bar = Math.max(1, map.beatsPerBar);
  return ((index - map.barPhase) % bar + bar) % bar === 0;
}

/** 二分查找：第一个时刻 >= timeMs 的拍下标 */
export function beatIndexAtOrAfter(beats: readonly number[], timeMs: number): number {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid]! < timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 平均拍长（毫秒） */
export function averageBeatMs(beats: readonly number[]): number {
  if (beats.length < 2) return 500;
  return (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1);
}

/** 整体平移时间轴（正数 = 提前） */
export function shiftBeatMap(map: ChartBeatMap, shiftMs: number): ChartBeatMap {
  if (!shiftMs) return map;
  return { ...map, beats: map.beats.map((t) => t - shiftMs) };
}
