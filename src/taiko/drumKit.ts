/**
 * 内置鼓音色（纯 WebAudio 合成，不下载任何采样文件）：
 * 命中鼓面时按力度触发对应音色，走独立的总音量节点，
 * 与 stem 播放互不影响。安卓中低端机上开销极小（每次几个 node，短促释放）。
 *
 * 默认开启，可在演奏界面关闭；开关状态存 localStorage。
 */
import { getAudioContext } from "./metronome";
import type { PartId } from "./laneLayouts";

const KEY = "taiko.kit.v1";

export function loadKitEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

/** 开关变化的订阅者（谱面页全局参数与教学共享同一状态） */
const kitListeners = new Set<(on: boolean) => void>();

export function subscribeKitEnabled(fn: (on: boolean) => void): () => void {
  kitListeners.add(fn);
  return () => kitListeners.delete(fn);
}

export function saveKitEnabled(on: boolean): boolean {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // 忽略
  }
  for (const fn of kitListeners) fn(on);
  return on;
}


let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function bus(ctx: AudioContext): GainNode {
  if (!master || master.context !== ctx) {
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  return master;
}

/** 2 秒白噪声，全部音色共用（只生成一次） */
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = buf;
  return buf;
}

interface NoiseOpts {
  t: number;
  gain: number;
  decay: number;
  type: BiquadFilterType;
  freq: number;
  q?: number;
  attack?: number;
}

function noiseHit(ctx: AudioContext, o: NoiseOpts): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.playbackRate.value = 1;
  const filt = ctx.createBiquadFilter();
  filt.type = o.type;
  filt.frequency.value = o.freq;
  filt.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const a = o.attack ?? 0.001;
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + a + o.decay);
  src.connect(filt);
  filt.connect(g);
  g.connect(bus(ctx));
  src.start(o.t, Math.random() * 1.5);
  src.stop(o.t + a + o.decay + 0.02);
}

interface ToneOpts {
  t: number;
  gain: number;
  decay: number;
  from: number;
  to: number;
  type?: OscillatorType;
}

function toneHit(ctx: AudioContext, o: ToneOpts): void {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.from, o.t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), o.t + o.decay);
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(0.0002, o.gain), o.t);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.decay);
  osc.connect(g);
  g.connect(bus(ctx));
  osc.start(o.t);
  osc.stop(o.t + o.decay + 0.02);
}

/**
 * 触发一次鼓音色。
 * @param part 鼓件
 * @param velocity MIDI 力度 1~127（键盘触发默认 100）
 */
export function playDrum(part: PartId, velocity = 100): void {
  const ctx = getAudioContext();
  const t = ctx.currentTime + 0.001;
  const v = Math.max(0.25, Math.min(1, velocity / 110));

  switch (part) {
    case "kick":
      // 音高下滑的鼓体 + 一层短促点击，低端喇叭上也能听清
      toneHit(ctx, { t, gain: 0.95 * v, decay: 0.26, from: 130, to: 45 });
      noiseHit(ctx, { t, gain: 0.18 * v, decay: 0.03, type: "lowpass", freq: 1800 });
      break;
    case "snare":
      // 噪声主体（带通）+ 一层音体，军鼓的「脆」来自 1.8kHz 附近
      noiseHit(ctx, { t, gain: 0.6 * v, decay: 0.16, type: "bandpass", freq: 1800, q: 0.8 });
      noiseHit(ctx, { t, gain: 0.28 * v, decay: 0.05, type: "highpass", freq: 4200 });
      toneHit(ctx, { t, gain: 0.3 * v, decay: 0.09, from: 220, to: 170, type: "triangle" });
      break;
    case "hihat":
      // 闭镲：极短高通噪声
      noiseHit(ctx, { t, gain: 0.42 * v, decay: 0.045, type: "highpass", freq: 7200, q: 0.7 });
      noiseHit(ctx, { t, gain: 0.2 * v, decay: 0.02, type: "bandpass", freq: 11000, q: 1.2 });
      break;
    case "pedalHat":
      // 踩踏：更闷更短
      noiseHit(ctx, { t, gain: 0.3 * v, decay: 0.035, type: "bandpass", freq: 5200, q: 0.9 });
      break;
    case "crash":
      // 吊镲：长衰减亮噪声
      noiseHit(ctx, { t, gain: 0.4 * v, decay: 1.5, type: "highpass", freq: 5200, attack: 0.004 });
      noiseHit(ctx, { t, gain: 0.2 * v, decay: 0.5, type: "bandpass", freq: 9000, q: 0.6 });
      break;
    case "ride":
      // 叮叮镲：明显的「叮」+ 较短的水声
      noiseHit(ctx, { t, gain: 0.22 * v, decay: 0.9, type: "highpass", freq: 6800, attack: 0.003 });
      toneHit(ctx, { t, gain: 0.16 * v, decay: 0.35, from: 3200, to: 2600, type: "triangle" });
      break;
    case "highTom":
      toneHit(ctx, { t, gain: 0.7 * v, decay: 0.28, from: 320, to: 180 });
      noiseHit(ctx, { t, gain: 0.14 * v, decay: 0.05, type: "bandpass", freq: 2600 });
      break;
    case "midTom":
      toneHit(ctx, { t, gain: 0.7 * v, decay: 0.32, from: 250, to: 140 });
      noiseHit(ctx, { t, gain: 0.13 * v, decay: 0.05, type: "bandpass", freq: 2200 });
      break;
    case "floorTom":
      toneHit(ctx, { t, gain: 0.8 * v, decay: 0.42, from: 180, to: 95 });
      noiseHit(ctx, { t, gain: 0.12 * v, decay: 0.06, type: "bandpass", freq: 1600 });
      break;
  }
}
