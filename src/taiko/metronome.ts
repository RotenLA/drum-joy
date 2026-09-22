/**
 * 共享 AudioContext + 节拍器。
 * 节拍器两种模式：自由运行（getPositionMs 返回 null）或跟随外部时钟
 * （如歌曲播放器），按 beat 网格用 30ms 轮询 + 150ms 前瞻调度滴答声。
 */
import { isAndroid } from "./platform";

let sharedCtx: AudioContext | null = null;

type Ctor = new (opts?: AudioContextOptions) => AudioContext;

function createCtx(): AudioContext {
  const w = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  const Ctx = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctx) throw new Error("当前环境不支持 Web Audio");
  // 安卓硬件原生采样率基本都是 48kHz：显式锁定可跳过系统重采样，省下 20~30ms 延迟
  const opts: AudioContextOptions = isAndroid()
    ? { latencyHint: "interactive", sampleRate: 48000 }
    : { latencyHint: "interactive" };
  try {
    return new Ctx(opts);
  } catch {
    try {
      return new Ctx({ latencyHint: "interactive" });
    } catch {
      return new Ctx();
    }
  }
}

export function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = createCtx();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

/** 输出链路实测延迟（毫秒）：baseLatency + outputLatency，取不到给 0 */
export function outputLatencyMs(): number {
  if (!sharedCtx) return 0;
  const base = Number(sharedCtx.baseLatency ?? 0);
  const out = Number((sharedCtx as AudioContext & { outputLatency?: number }).outputLatency ?? 0);
  const ms = (base + out) * 1000;
  return Number.isFinite(ms) ? Math.round(ms) : 0;
}

/** 单次滴答（倒计时 / 手动触发用）。whenSec 为 AudioContext 时钟时间 */
export function click(accent = false, whenSec?: number): void {
  const ctx = getAudioContext();
  const t = Math.max(whenSec ?? ctx.currentTime, ctx.currentTime);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = accent ? 2000 : 1300;
  gain.gain.setValueAtTime(accent ? 0.14 : 0.1, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.07);
}

export interface MetronomeOptions {
  bpm: number;
  /** 每小节拍数（拍号换算成四分音符拍，如 6/8 = 3），首拍重音 */
  beatsPerBar: number;
  /** 外部时钟位置（毫秒）；返回 null = 自由运行 */
  getPositionMs?: () => number | null;
  /** 首拍偏移（毫秒），跟歌模式下对齐节拍网格 */
  offsetMs?: number;
}

export class Metronome {
  private timer: number | null = null;

  start(opts: MetronomeOptions): void {
    this.stop();
    const ctx = getAudioContext();
    const beatMs = 60000 / opts.bpm;
    const offset = opts.offsetMs ?? 0;
    const barBeats = Math.max(1, Math.round(opts.beatsPerBar));
    const freeStartSec = ctx.currentTime + 0.05;
    let nextBeatIdx = 0;
    let lastPos: number | null = null;

    const tick = () => {
      const pos = opts.getPositionMs?.() ?? null;
      const nowSec = ctx.currentTime;

      // 外部时钟倒退（seek）→ 重新对齐
      if (pos !== null && lastPos !== null && pos < lastPos - 500) {
        nextBeatIdx = Math.max(0, Math.ceil((pos - offset) / beatMs));
      }
      if (pos !== null) lastPos = pos;

      if (pos === null) {
        // 自由运行
        for (;;) {
          const beatSec = freeStartSec + (nextBeatIdx * beatMs) / 1000;
          if (beatSec > nowSec + 0.15) break;
          click(nextBeatIdx % barBeats === 0, beatSec);
          nextBeatIdx++;
        }
      } else {
        // 跟随歌曲位置
        if (nextBeatIdx === 0 && pos > offset) {
          nextBeatIdx = Math.max(0, Math.ceil((pos - offset) / beatMs));
        }
        for (;;) {
          const beatPos = offset + nextBeatIdx * beatMs;
          if (beatPos > pos + 150) break;
          if (beatPos >= pos - 20) {
            click(nextBeatIdx % barBeats === 0, nowSec + Math.max(0, (beatPos - pos) / 1000));
          }
          nextBeatIdx++;
        }
      }
    };
    this.timer = window.setInterval(tick, 30);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}
