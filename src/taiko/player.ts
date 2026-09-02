import { getAudioContext } from "./metronome";
import { STEM_KINDS, emptyStems, type StemKind, type StemMap } from "./stems";

/**
 * 多轨 stem 播放器：所有音轨共用一个起播时刻，各自一条 GainNode。
 * 时钟由 AudioContext.currentTime 换算，接口与单轨版本保持一致。
 */
class SongPlayer {
  private stems: StemMap = emptyStems();
  private sources: Partial<Record<StemKind, AudioBufferSourceNode>> = {};
  private gains: Partial<Record<StemKind, GainNode>> = {};
  private levels: Record<StemKind, number> = {
    vocals: 1,
    drums: 0,
    bass: 1,
    other: 1,
  };
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

  get durationMs(): number {
    let max = 0;
    for (const k of STEM_KINDS) {
      const t = this.stems[k];
      if (t) max = Math.max(max, t.buffer.duration * 1000);
    }
    return max;
  }

  /** 音量 0~1，1 = 原始文件音量（不做超过峰值的放大） */
  setStemGain(kind: StemKind, value: number): void {
    const v = Math.min(1, Math.max(0, value));
    this.levels[kind] = v;
    const g = this.gains[kind];
    if (g) g.gain.value = v;
  }

  getStemGain(kind: StemKind): number {
    return this.levels[kind];
  }

  play(fromMs?: number): void {
    if (!this.hasAudio) return;
    this.stopSources();
    const ctx = getAudioContext();
    const offset = Math.min(
      Math.max(fromMs ?? this.positionMs, 0),
      Math.max(0, this.durationMs - 10),
    );
    this.startOffsetMs = offset;
    this.startCtxSec = ctx.currentTime + 0.05;

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
      gain.connect(ctx.destination);
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
      src.start(this.startCtxSec, Math.min(offset / 1000, Math.max(0, track.buffer.duration - 0.01)));
      this.sources[k] = src;
      this.gains[k] = gain;
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

  timeMs(): number {
    if (!this.playing) return this.positionMs;
    return Math.min(
      this.durationMs,
      this.startOffsetMs + (getAudioContext().currentTime - this.startCtxSec) * 1000,
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
    }
  }
}

export const songPlayer = new SongPlayer();
