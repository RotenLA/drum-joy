import { getAudioContext } from "./metronome";
import { STEM_KINDS, emptyStems, type StemKind, type StemMap } from "./stems";

/** 四条分轨统一补偿 +3dB；用户滑杆仍保持 0~1 的原有语义。 */
const STEM_MAKEUP_GAIN = 10 ** (3 / 20);

/**
 * 多轨 stem 播放器：所有音轨共用一个起播时刻，各自一条 GainNode。
 * 时钟由 AudioContext.currentTime 换算，接口与单轨版本保持一致。
 */
class SongPlayer {
  private stems: StemMap = emptyStems();
  private sources: Partial<Record<StemKind, AudioBufferSourceNode>> = {};
  private gains: Partial<Record<StemKind, GainNode>> = {};
  private makeups: Partial<Record<StemKind, GainNode>> = {};
  private levels: Record<StemKind, number> = {
    vocals: 1,
    drums: 0,
    bass: 1,
    other: 1,
  };
  private leadMs = 0;
  private startCtxSec = 0;
  private startOffsetMs = 0;
  private positionMs = 0;
  private endedCb: (() => void) | null = null;
  playing = false;

  load(stems: StemMap): void {
    this.stop();
    this.stems = stems;
    this.positionMs = 0;
  }

  setOnEnded(cb: (() => void) | null): void {
    this.endedCb = cb;
  }

  get hasAudio(): boolean {
    return STEM_KINDS.some((k) => this.stems[k] !== null);
  }

  /** 文件原始总长（含开头空白） */
  private get rawDurationMs(): number {
    let max = 0;
    for (const k of STEM_KINDS) {
      const t = this.stems[k];
      if (t) max = Math.max(max, t.buffer.duration * 1000);
    }
    return max;
  }

  /** 对外时间轴：已扣掉开头空白 */
  get durationMs(): number {
    return Math.max(0, this.rawDurationMs - this.leadMs);
  }

  /**
   * 设定开头空白长度（毫秒）。设定后所有对外时间（play / timeMs / durationMs）
   * 都以「空白之后」为 0 点，四条音轨统一跳过同一段，彼此仍然对齐。
   */
  setLeadMs(ms: number): void {
    const v = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    if (v === this.leadMs) return;
    this.leadMs = v;
    if (!this.playing) this.positionMs = 0;
  }

  /** 音量 0~1，1 = 原始文件音量（不做超过峰值的放大） */
  setStemGain(kind: StemKind, value: number): void {
    const v = Math.min(2, Math.max(0, value));
    this.levels[kind] = v;
    const g = this.gains[kind];
    if (g) g.gain.value = v;
  }

  getStemGain(kind: StemKind): number {
    return this.levels[kind];
  }

  /**
   * 起播。atCtxSec 给定绝对的 AudioContext 时刻（用于倒计时：先排程，
   * 时钟从负数连续走到 0，切换时不会跳位）。
   */
  play(fromMs?: number, atCtxSec?: number): void {
    if (!this.hasAudio) return;
    this.stopSources();
    const ctx = getAudioContext();
    const offset = Math.min(
      Math.max(fromMs ?? this.positionMs, 0),
      Math.max(0, this.durationMs - 10),
    );
    this.startOffsetMs = offset;
    this.startCtxSec = Math.max(atCtxSec ?? ctx.currentTime + 0.05, ctx.currentTime + 0.02);

    // 结束回调挂在最长的一轨上
    let longest: StemKind | null = null;
    let longestDur = -1;
    for (const k of STEM_KINDS) {
      const t = this.stems[k];
      if (t && t.buffer.duration > longestDur) {
        longestDur = t.buffer.duration;
        longest = k;
      }
    }

    for (const k of STEM_KINDS) {
      const track = this.stems[k];
      if (!track) continue;
      const gain = ctx.createGain();
      gain.gain.value = this.levels[k];
      const makeup = ctx.createGain();
      makeup.gain.value = STEM_MAKEUP_GAIN;
      gain.connect(makeup);
      makeup.connect(ctx.destination);
      const src = ctx.createBufferSource();
      src.buffer = track.buffer;
      src.connect(gain);
      if (k === longest) {
        src.onended = () => {
          if (this.sources[k] !== src) return; // 手动停止，忽略
          this.stopSources();
          this.playing = false;
          this.positionMs = this.durationMs;
          this.endedCb?.();
        };
      }
      src.start(
        this.startCtxSec,
        Math.min((offset + this.leadMs) / 1000, Math.max(0, track.buffer.duration - 0.01)),
      );
      this.sources[k] = src;
      this.gains[k] = gain;
      this.makeups[k] = makeup;
    }
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.positionMs = this.timeMs();
    this.stopSources();
    this.playing = false;
  }

  stop(): void {
    this.stopSources();
    this.playing = false;
    this.positionMs = 0;
  }

  seek(ms: number): void {
    const t = Math.min(Math.max(ms, 0), this.durationMs);
    if (this.playing) this.play(t);
    else this.positionMs = t;
  }

  /**
   * 设备输出延迟（毫秒）：安卓 WebView 上常有 100~200ms，
   * 计入后「听到的位置」才与判定时钟一致。
   */
  outputLatencyMs(): number {
    const ctx = getAudioContext() as AudioContext & { outputLatency?: number };
    const l = ctx.outputLatency ?? ctx.baseLatency ?? 0;
    return Number.isFinite(l) ? Math.min(0.5, Math.max(0, l)) * 1000 : 0;
  }

  timeMs(): number {
    if (!this.playing) return this.positionMs;
    return Math.min(
      this.durationMs,
      this.startOffsetMs +
        (getAudioContext().currentTime - this.startCtxSec) * 1000 -
        this.outputLatencyMs(),
    );
  }

  private stopSources(): void {
    for (const k of STEM_KINDS) {
      const s = this.sources[k];
      delete this.sources[k];
      if (s) {
        s.onended = null;
        try {
          s.stop();
        } catch {
          // 已停止
        }
        try {
          s.disconnect();
        } catch {
          // 已断开
        }
      }
      const g = this.gains[k];
      delete this.gains[k];
      if (g) {
        try {
          g.disconnect();
        } catch {
          // 已断开
        }
      }
      const makeup = this.makeups[k];
      delete this.makeups[k];
      if (makeup) {
        try {
          makeup.disconnect();
        } catch {
          // 已断开
        }
      }
    }
  }
}

export const songPlayer = new SongPlayer();
