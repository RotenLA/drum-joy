/**
 * 画质档位与自动降档：中低端安卓机上把每帧开销压下来。
 *
 * 三档：high（现有效果）/ medium（去发光模糊、少粒子）/ low（纯色、无粒子、限 30 帧）。
 * 默认 auto：按实测帧时间自动降档（只降不升，带冷却，避免来回抖动）。
 */

export type QualityTier = "high" | "medium" | "low";
export type QualityMode = "auto" | QualityTier;

export interface QualityParams {
  /** 是否使用 shadowBlur 发光（安卓上最贵的一项） */
  glow: boolean;
  /** 单次命中的粒子数，0 = 不喷粒子 */
  particles: number;
  /** 画布像素比上限 */
  maxDpr: number;
  /** 帧率上限 */
  maxFps: number;
  /** 背景是否做压灰滤镜（离屏只做一次，低档仍省一次滤镜） */
  bgFilter: boolean;
}

export const QUALITY: Record<QualityTier, QualityParams> = {
  high: { glow: true, particles: 12, maxDpr: 2, maxFps: 60, bgFilter: true },
  medium: { glow: false, particles: 6, maxDpr: 1.5, maxFps: 60, bgFilter: true },
  low: { glow: false, particles: 0, maxDpr: 1, maxFps: 30, bgFilter: false },
};

export const TIER_LABEL: Record<QualityMode, string> = {
  auto: "自动",
  high: "高",
  medium: "中",
  low: "低",
};

const STORE_KEY = "taiko.quality.v1";
const TIERS: QualityTier[] = ["high", "medium", "low"];
/** 平均帧时间超过该值视为跑不动（≈38 帧） */
const SLOW_FRAME_MS = 26;
/** 连续多少帧超标才降档 */
const SLOW_STREAK = 45;
/** 两次降档之间的冷却，避免瞬时卡顿连降到底 */
const COOLDOWN_MS = 3000;

class QualityController {
  private mode: QualityMode = "auto";
  private autoTier: QualityTier = "high";
  private slow = 0;
  private lastDrop = 0;
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw === "auto" || TIERS.includes(raw as QualityTier)) {
          this.mode = raw as QualityMode;
        }
      } catch {
        // 存储不可用，用默认
      }
    }
  }

  getMode(): QualityMode {
    return this.mode;
  }

  setMode(m: QualityMode): void {
    this.mode = m;
    this.slow = 0;
    if (m === "auto") this.autoTier = "high";
    try {
      localStorage.setItem(STORE_KEY, m);
    } catch {
      // 忽略
    }
    for (const f of this.listeners) f();
  }

  get tier(): QualityTier {
    return this.mode === "auto" ? this.autoTier : this.mode;
  }

  get params(): QualityParams {
    return QUALITY[this.tier];
  }

  /** 每帧喂一个帧间隔（毫秒），auto 模式据此降档 */
  sample(dtMs: number, now: number): void {
    if (this.mode !== "auto") return;
    if (dtMs <= 0 || dtMs > 500) return; // 切后台等异常值忽略
    if (dtMs > SLOW_FRAME_MS) this.slow++;
    else this.slow = Math.max(0, this.slow - 2);
    if (this.slow < SLOW_STREAK) return;
    this.slow = 0;
    if (now - this.lastDrop < COOLDOWN_MS) return;
    const i = TIERS.indexOf(this.autoTier);
    if (i >= TIERS.length - 1) return;
    this.autoTier = TIERS[i + 1]!;
    this.lastDrop = now;
    for (const f of this.listeners) f();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const quality = new QualityController();
