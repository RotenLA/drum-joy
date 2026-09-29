/**
 * 音频与 MIDI 的第一拍咬合。
 *
 * AI 分轨导出的鼓 MIDI 与真实鼓分轨音频，第一声之间常有几十毫秒固有偏差。
 * 这里测出鼓轨真实起振时刻与 MIDI 第一个鼓点的时间差，谱面整体再平移这个差值，
 * 让玩家听到第一声鼓的瞬间，正好是第一个音符落到判定线的瞬间。
 */
import { GM_TO_PART } from "./midiChart";
import type { ParsedMidi } from "./midiFile";
import { drumsOnsetMs, type StemMap } from "./stems";

/** 允许的最大咬合修正（毫秒）：超出说明测量不可信，宁可不动 */
const MAX_ALIGN_MS = 120;

/** MIDI 第一个鼓点时刻（毫秒） */
export function midiFirstHitMs(midi: ParsedMidi): number | null {
  let first: number | null = null;
  for (const n of midi.notes) {
    if (GM_TO_PART[n.note] === undefined) continue;
    if (first === null || n.timeMs < first) first = n.timeMs;
  }
  return first;
}

/**
 * 谱面需要额外平移的毫秒数 = MIDI 首个鼓点 − 鼓轨真实首次起振。
 * 正数表示 MIDI 比音频晚，谱面要提前；取不到测量值时返回 0。
 */
export function audioAlignMs(stems: StemMap, midi: ParsedMidi | null): number {
  if (!midi) return 0;
  const onset = drumsOnsetMs(stems);
  const first = midiFirstHitMs(midi);
  if (onset === null || first === null) return 0;
  const delta = first - onset;
  if (!Number.isFinite(delta)) return 0;
  return Math.round(Math.max(-MAX_ALIGN_MS, Math.min(MAX_ALIGN_MS, delta)));
}
