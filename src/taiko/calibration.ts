/**
 * 延迟校准只移动歌曲播放，不移动谱面、音符或判定窗。
 * playbackMs：正数让歌曲提前，负数让歌曲延后。
 */
export interface Calibration {
  playbackMs: number;
}

const KEY = "taiko.calib.v6";
export const CALIB_RANGE = 200;
export const DEFAULT_CALIBRATION: Calibration = { playbackMs: 0 };

/** 当前平台的默认偏移 */
export function platformDefaultCalibration(): Calibration {
  return { ...DEFAULT_CALIBRATION };
}

const clamp = (v: number) => Math.max(-CALIB_RANGE, Math.min(CALIB_RANGE, Math.round(v || 0)));

export function loadCalibration(): Calibration {
  const base = platformDefaultCalibration();
  if (typeof localStorage === "undefined") return base;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Calibration>;
    return { playbackMs: clamp(p.playbackMs ?? base.playbackMs) };
  } catch {
    return base;
  }
}

export function saveCalibration(c: Calibration): Calibration {
  const next = { playbackMs: clamp(c.playbackMs) };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent<Calibration>("taiko:calibration", { detail: next }));
  } catch {
    // 忽略
  }
  return next;
}

export function subscribeCalibration(listener: (calibration: Calibration) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onChange = (event: Event) => {
    const custom = event as CustomEvent<Calibration>;
    listener(custom.detail ?? loadCalibration());
  };
  window.addEventListener("taiko:calibration", onChange);
  return () => window.removeEventListener("taiko:calibration", onChange);
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
