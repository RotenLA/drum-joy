/**
 * 特雷门合成器：正弦 + 三角两个振荡器交叉淡化，音高/音量连续平滑变化。
 * 左手颤音：低频振荡器调制两个振荡器的 detune（音分）。
 */
const MIN_HZ = 196; // G3
const OCTAVES = 2;

export class ThereminEngine {
  private ctx: AudioContext | null = null;
  private sine: OscillatorNode | null = null;
  private tri: OscillatorNode | null = null;
  private sineGain: GainNode | null = null;
  private triGain: GainNode | null = null;
  private gate: GainNode | null = null;
  private volume: GainNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoDepth: GainNode | null = null;

  start(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: "interactive" });
    this.ctx = ctx;
    const mk = (type: OscillatorType) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = MIN_HZ * 2;
      return o;
    };
    this.sine = mk("sine");
    this.tri = mk("triangle");
    this.sineGain = ctx.createGain();
    this.triGain = ctx.createGain();
    this.sineGain.gain.value = 1;
    this.triGain.gain.value = 0;
    this.gate = ctx.createGain();
    this.gate.gain.value = 0;
    this.volume = ctx.createGain();
    this.volume.gain.value = 0.5;
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 5;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0;
    this.lfo.connect(this.lfoDepth);
    this.lfoDepth.connect(this.sine.detune);
    this.lfoDepth.connect(this.tri.detune);
    this.sine.connect(this.sineGain).connect(this.gate);
    this.tri.connect(this.triGain).connect(this.gate);
    this.gate.connect(this.volume).connect(ctx.destination);
    this.sine.start();
    this.tri.start();
    this.lfo.start();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  stop(): void {
    try {
      void this.ctx?.close();
    } catch {
      /* 已关闭 */
    }
    this.ctx = null;
  }

  private get t(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** 右踏板：发声/停声 */
  setGate(on: boolean): void {
    if (!this.gate) return;
    this.resume();
    this.gate.gain.cancelScheduledValues(this.t);
    this.gate.gain.setTargetAtTime(on ? 1 : 0, this.t, on ? 0.01 : 0.027);
  }

  /** 左踏板：true=三角波，false=正弦波，约 150ms 交叉淡化 */
  setTriangle(on: boolean): void {
    if (!this.sineGain || !this.triGain) return;
    this.sineGain.gain.setTargetAtTime(on ? 0 : 1, this.t, 0.05);
    this.triGain.gain.setTargetAtTime(on ? 0.85 : 0, this.t, 0.05);
  }

  /** 音高 0..1（两个八度内连续），返回频率 */
  setPitch(x: number): number {
    const hz = MIN_HZ * Math.pow(2, Math.max(0, Math.min(1, x)) * OCTAVES);
    if (this.sine && this.tri) {
      this.sine.frequency.setTargetAtTime(hz, this.t, 0.003);
      this.tri.frequency.setTargetAtTime(hz, this.t, 0.003);
    }
    return hz;
  }

  /** 音量 0..1 */
  setVolume(v: number): void {
    this.volume?.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.7, this.t, 0.004);
  }

  /** 颤音：depth 0..1（最多 ±60 音分），rate 0..1（3~8Hz） */
  setVibrato(depth: number, rate: number): void {
    this.lfoDepth?.gain.setTargetAtTime(Math.max(0, Math.min(1, depth)) * 60, this.t, 0.05);
    this.lfo?.frequency.setTargetAtTime(3 + Math.max(0, Math.min(1, rate)) * 5, this.t, 0.08);
  }
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function noteName(hz: number): string {
  const m = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}
export const THEREMIN_MIN_HZ = MIN_HZ;
export const THEREMIN_OCTAVES = OCTAVES;
