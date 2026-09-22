/**
 * 运行环境探测 + 低版本 WebView 兜底。
 * 安卓 WebView 的音频链路（AAudio / OpenSL ES）缓冲远大于 iOS，
 * 且部分安卓 13 机型自带的 WebView 内核较旧（Chrome < 111），
 * 这里集中处理平台差异与 API 兜底，避免各模块各写一套。
 */

const ua = (): string =>
  typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
    ? navigator.userAgent
    : "";

export const isAndroid = (): boolean => /android/i.test(ua());

/** Android 系统大版本，仅用于诊断；是否支持应用以 WebView 能力为准。 */
export function androidVersion(): number {
  const m = /android\s+([0-9.]+)/i.exec(ua());
  return m ? Number.parseFloat(m[1] ?? "0") : 0;
}

export const isIOS = (): boolean =>
  /iphone|ipad|ipod/i.test(ua()) ||
  (/macintosh/i.test(ua()) &&
    typeof navigator !== "undefined" &&
    (navigator.maxTouchPoints ?? 0) > 1);

/** WebView 内核大版本号（Chrome / Safari），取不到返回 0 */
export function engineVersion(): number {
  const m = /(?:chrome|crios|version)\/(\d+)/i.exec(ua());
  return m ? Number(m[1]) : 0;
}

/** 内核过旧（不支持 oklch / color-mix 等现代 CSS）时为 true */
export const isLegacyEngine = (): boolean => {
  const v = engineVersion();
  return isAndroid() && v > 0 && v < 111;
};

export interface CompatibilityResult {
  supported: boolean;
  engine: number;
  reason: "engine" | "canvas" | "audio" | null;
}

/** 核心能力检查。版本未知时不误拦，改由实际能力决定。 */
export function compatibilityResult(): CompatibilityResult {
  if (typeof window === "undefined" || !isAndroid()) {
    return { supported: true, engine: engineVersion(), reason: null };
  }
  const engine = engineVersion();
  if (engine > 0 && engine < 90) return { supported: false, engine, reason: "engine" };
  const canvas = typeof document !== "undefined" && Boolean(document.createElement("canvas").getContext);
  if (!canvas) return { supported: false, engine, reason: "canvas" };
  const w = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  if (!w.AudioContext && !w.webkitAudioContext) return { supported: false, engine, reason: "audio" };
  return { supported: true, engine, reason: null };
}

/** localStorage 在未开启 DOM Storage 的 WebView 里会直接抛异常 */
export const storage = {
  get(key: string): string | null {
    try {
      return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 只读环境：仅保留内存状态
    }
  },
};

/** 非 HTTPS 环境下 crypto.randomUUID 可能不存在 */
export function randomId(): string {
  try {
    const c = globalThis.crypto as Crypto | undefined;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch {
    // 走下面的兜底
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
