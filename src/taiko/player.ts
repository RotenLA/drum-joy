import { getAudioContext } from "./metronome";

/**
 * 歌曲播放器：AudioContext 时钟驱动（timeMs 直接由 currentTime 换算），
 * 支持 seek / pause / 自然结束回调。全局单例，谱面屏与游玩屏共用。
 */
class SongPlayer {
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startCtxSec = 0;
  private startOffsetMs = 0;
  private positionMs = 0;
  private endedCb: (() => void) | null = null;
  playing = false;

  load(buffer: AudioBuffer | null): void {
    this.stop();
    this.buffer = buffer;
    this.positionMs = 0;
  }

  setOnEnded(cb: (() => void) | null): void {
    this.endedCb = cb;
  }

  get durationMs(): number {
    return this.buffer ? this.buffer.duration * 1000 : 0;
  }

  play(fromMs?: number): void {
    if (!this.buffer) return;
    this.stopSource();
    const ctx = getAudioContext();
    const offset = Math.min(
      Math.max(fromMs ?? this.positionMs, 0),
      Math.max(0, this.durationMs - 10),
    );
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(ctx.destination);
    this.startOffsetMs = offset;
    this.startCtxSec = ctx.currentTime + 0.05;
    src.start(this.startCtxSec, offset / 1000);
    src.onended = () => {
      if (this.src !== src) return; // 手动停止，忽略
      this.src = null;
      this.playing = false;
      this.positionMs = this.durationMs;
      this.endedCb?.();
    };
    this.src = src;
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.positionMs = this.timeMs();
    this.stopSource();
    this.playing = false;
  }

  stop(): void {
    this.stopSource();
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
      this.startOffsetMs +
        (getAudioContext().currentTime - this.startCtxSec) * 1000,
    );
  }

  private stopSource(): void {
    const s = this.src;
    this.src = null;
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
  }
}

export const songPlayer = new SongPlayer();
