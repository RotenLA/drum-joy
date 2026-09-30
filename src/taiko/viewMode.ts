/**
 * 视觉模式：舞台下落式（扇形鼓盘）/ 横排下落式（经典透视车道）。
 * 只影响画面渲染，判定、计时、音频完全共用。
 */

export type ViewMode = "stage" | "columns";

const KEY = "taiko.viewMode.v1";

let current: ViewMode = "stage";
let hydrated = false;

const listeners = new Set<(mode: ViewMode) => void>();

export function loadViewMode(): ViewMode {
  if (hydrated) return current;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "columns" || raw === "stage") current = raw;
  } catch {
    // 存储不可用时使用默认值
  }
  return current;
}

export function setViewMode(mode: ViewMode): void {
  loadViewMode();
  if (mode === current) return;
  current = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // 忽略写入失败
  }
  for (const fn of listeners) fn(mode);
}

export function subscribeViewMode(fn: (mode: ViewMode) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
