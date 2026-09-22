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
