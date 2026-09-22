/**
 * 输入抖动量表：只做统计，不影响手感。
 *
 * 两组数据：
 *  1. 输入延迟 = 真实敲击时刻（宿主/MIDI 时间戳）到网页实际处理时刻之差；
 *  2. 长帧统计 = 渲染帧间隔超过阈值的次数与最近一次耗时。
 *
 * 判读方式：输入延迟≈0 而长帧在涨 → 网页卡顿；输入延迟本身在跳 → 事件在宿主侧就晚了。
 */

/** 超过该帧间隔视为一次长帧（≈33 帧） */
const LONG_FRAME_MS = 30;
/** 输入延迟保留的最近样本数 */
const WINDOW = 50;

class LatencyMeter {
  private inputs: number[] = [];
  private lastInput = 0;
  private longFrames = 0;
  private lastLongFrameMs = 0;

  /** 记录一次敲击的处理延迟（毫秒） */
  recordInput(delayMs: number): void {
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 2000) return;
    this.lastInput = delayMs;
    this.inputs.push(delayMs);
    if (this.inputs.length > WINDOW) this.inputs.splice(0, this.inputs.length - WINDOW);
  }

  /** 记录一帧的间隔（毫秒） */
  recordFrame(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > 2000) return;
    if (dtMs > LONG_FRAME_MS) {
      this.longFrames++;
      this.lastLongFrameMs = dtMs;
    }
  }

  /** 最近一次输入延迟（毫秒，取整） */
  get inputMs(): number {
    return Math.round(this.lastInput);
  }

  /** 最近 50 次输入延迟的最大值（毫秒，取整） */
  get inputMaxMs(): number {
    let max = 0;
    for (const v of this.inputs) if (v > max) max = v;
    return Math.round(max);
  }

  get longFrameCount(): number {
    return this.longFrames;
  }

  get lastLongFrame(): number {
    return Math.round(this.lastLongFrameMs);
  }

  reset(): void {
    this.inputs = [];
    this.lastInput = 0;
    this.longFrames = 0;
    this.lastLongFrameMs = 0;
  }
}

export const latencyMeter = new LatencyMeter();
