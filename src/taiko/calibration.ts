/**
 * 延迟校准：安卓 WebView 的音频输出与触发链路常有 100~200ms 延迟，
 * 这里保存两个偏移量并提供一个「跟拍 8 下」的自动测算。
 *
 * visualMs：音符视觉偏移（正数 = 音符看起来更早到）
 * judgeMs ：判定偏移（正数 = 认为玩家敲得偏晚，把判定窗往后挪）
 */

export interface Calibration {
  visualMs: number;
  judgeMs: number;
}

const KEY = "taiko.calib.v5";
export const CALIB_RANGE = 200;
/** 空气鼓输入延迟约 80~100ms，网页端发声链路约 20ms */
export const DEFAULT_CALIBRATION: Calibration = { visualMs: 90, judgeMs: 20 };

const clamp = (v: number) => Math.max(-CALIB_RANGE, Math.min(CALIB_RANGE, Math.round(v || 0)));

export function loadCalibration(): Calibration {
  if (typeof localStorage === "undefined") return { ...DEFAULT_CALIBRATION };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_CALIBRATION };
    const p = JSON.parse(raw) as Partial<Calibration>;
    return {
      visualMs: clamp(p.visualMs ?? DEFAULT_CALIBRATION.visualMs),
      judgeMs: clamp(p.judgeMs ?? DEFAULT_CALIBRATION.judgeMs),
    };
  } catch {
    return { ...DEFAULT_CALIBRATION };
  }
}

export function saveCalibration(c: Calibration): Calibration {
  const next = { visualMs: clamp(c.visualMs), judgeMs: clamp(c.judgeMs) };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 忽略
  }
  return next;
}

/**
 * 跟拍校准：给出每次敲击相对「最近拍点」的偏差中位数。
 * @param taps 敲击时刻（毫秒，与拍点同一时钟）
 * @param startMs 第一拍时刻
 * @param beatMs 一拍毫秒
 */
export function tapOffsetMs(taps: number[], startMs: number, beatMs: number): number {
  if (taps.length === 0 || beatMs <= 0) return 0;
  const diffs = taps
    .map((t) => {
      const k = Math.round((t - startMs) / beatMs);
      return t - (startMs + k * beatMs);
    })
    .filter((d) => Math.abs(d) < beatMs / 2)
    .sort((a, b) => a - b);
  if (diffs.length === 0) return 0;
  const mid = Math.floor(diffs.length / 2);
  const median = diffs.length % 2 === 1 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;
  return clamp(median);
}
