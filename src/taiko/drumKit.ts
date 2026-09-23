/**
 * 本地鼓音色：优先播放真实采样（9 套鼓组，后台按需加载），
 * 采样未就绪或加载失败时自动退回 WebAudio 合成音，保证一定有声音。
 *
 * 默认开启，可在谱面页全局参数里关闭；开关与鼓组选择都存 localStorage。
 */
import { getAudioContext } from "./metronome";
import { isAndroid, isIOS } from "./platform";
import type { PartId } from "./laneLayouts";
import { KIT_SAMPLES } from "./kitSamples";

const KEY = "taiko.kit.v1";
const KIT_ID_KEY = "taiko.kit.id.v1";

/**
 * 原始 MIDI 键位的响度修正（dB）。截图未列出的键位按 0 dB 处理；
 * 此后所有鼓声还会统一衰减 3 dB。
 */
export const NOTE_ATTENUATION_DB: Readonly<Record<number, number>> = {
  36: 0,
  37: -9,
  38: -3,
  39: -3,
  40: -3,
  41: -6,
  42: -12,
  43: -6,
  44: -12,
  45: -6,
  46: -9,
  47: -6,
  48: -6,
  49: -9,
  50: -6,
  51: -9,
  53: -3,
  54: -9,
  55: -3,
  56: -6,
};

const ALL_DRUMS_ATTENUATION_DB = -3;
const dbToGain = (db: number) => 10 ** (db / 20);

export function drumGainForNote(note?: number): number {
  const noteDb = note === undefined ? 0 : (NOTE_ATTENUATION_DB[note] ?? 0);
  return dbToGain(noteDb + ALL_DRUMS_ATTENUATION_DB);
}

/** 9 套鼓组（来自 PD2U 音色库 preset 0~8） */
export const KIT_NAMES: { id: number; zh: string; en: string }[] = [
  { id: 0, zh: "Pop 流行", en: "Pop" },
  { id: 1, zh: "Funk 放克", en: "Funk" },
  { id: 2, zh: "Rock 摇滚", en: "Rock" },
  { id: 3, zh: "808 电子", en: "808" },
  { id: 4, zh: "Club 俱乐部", en: "Club" },
  { id: 5, zh: "Sub 低频", en: "Sub" },
  { id: 6, zh: "Perc 打击", en: "Perc" },
  { id: 7, zh: "Table 桌面", en: "Table" },
  { id: 8, zh: "Toy 玩具", en: "Toy" },
];

export function loadKitEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

/** 开关变化的订阅者（谱面页全局参数与演奏页共享同一状态） */
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
  if (on) void ensureKitLoaded(loadKitId());
  return on;
}

// ---------------- 鼓组选择 ----------------

export function loadKitId(): number {
  if (typeof localStorage === "undefined") return 0;
  try {
    const raw = Number(localStorage.getItem(KIT_ID_KEY));
    return Number.isFinite(raw) && raw >= 0 && raw <= 8 ? Math.floor(raw) : 0;
  } catch {
    return 0;
  }
}

const kitIdListeners = new Set<(id: number) => void>();

export function subscribeKitId(fn: (id: number) => void): () => void {
  kitIdListeners.add(fn);
  return () => kitIdListeners.delete(fn);
}

export function saveKitId(id: number): number {
  try {
    localStorage.setItem(KIT_ID_KEY, String(id));
  } catch {
    // 忽略
  }
  for (const fn of kitIdListeners) fn(id);
  void ensureKitLoaded(id);
  return id;
}

// ---------------- 采样加载 ----------------

/** `${kitId}:${part}` -> AudioBuffer */
const buffers = new Map<string, AudioBuffer>();
const loading = new Set<number>();


/** 后台加载某套鼓组的全部样本；加载完成前继续用合成音兜底 */
export async function ensureKitLoaded(kitId: number): Promise<void> {
  if (typeof window === "undefined") return;
  const kit = KIT_SAMPLES[kitId];
  if (!kit || loading.has(kitId)) return;
  if (buffers.has(`${kitId}:kick`)) {
    releaseOtherKits(kitId);
    return;
  }
  loading.add(kitId);
  const ctx = getAudioContext();
  await Promise.all(
    Object.entries(kit).map(async ([part, urls]) => {
      try {
        const res = await fetch(urls.m4a);
        const raw = await res.arrayBuffer();
        // 原样解码保留：浏览器自己的混音管道会处理采样率差异，
        // 不再做离线转码，避免任何音高/长度上的细微改变
        const buf = await ctx.decodeAudioData(raw);
        buffers.set(`${kitId}:${part}`, buf);
      } catch {
        // 单个样本失败就继续用合成音
      }
    }),
  );
  loading.delete(kitId);
  releaseOtherKits(kitId);
}

/**
 * 只保留当前鼓组的采样在内存里。中低端安卓上 9 套鼓全留着会明显吃内存，
 * 内存紧张时整个 WebView 容易被系统回收。
 */
export function releaseOtherKits(keepKitId: number): void {
  const prefix = `${keepKitId}:`;
  for (const key of [...buffers.keys()]) {
    if (!key.startsWith(prefix)) buffers.delete(key);
  }
}

// ---------------- 采样回放（硬件采样器式直通） ----------------

/**
 * 返璞归真：像硬件鼓机一样，收到击打就建一个 BufferSource → 固定音量节点 →
 * 主输出，立刻 start(0)。
 * 不做排程换算、不做人为掐音、不做发声上限裁剪：
 *  - 同一帧内的多个鼓件必然被同一个声卡周期一起吐出，不会有先后错位；
 *  - 采样自己 0.2~1.5 秒就衰减完，浏览器自动回收，无需人工 stop()；
 *  - 不往音频渲染线程塞自动化曲线，不动态拆接节点图，杜绝突发卡顿与失谐。
 */
let voiceCount = 0;

function playSample(ctx: AudioContext, kitId: number, part: PartId, v: number): boolean {
  const buf = buffers.get(`${kitId}:${part}`);
  if (!buf) {
    void ensureKitLoaded(kitId);
    return false;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = v;
  src.connect(g);
  g.connect(bus(ctx));
  src.start(0);
  voiceCount++;
  src.onended = () => {
    voiceCount--;
    try {
      src.disconnect();
      g.disconnect();
    } catch {
      // 已断开
    }
  };
  return true;
}

/** 当前同时发声数（调试面板用） */
export function activeVoiceCount(): number {
  return voiceCount;
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



// ---------------- 音频时钟抖动量表 ----------------

let clockBaseMs: number | null = null;
let clockSkewMaxMs = 0;

const perfNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * 每次发声记一下「主线程时钟 − 音频时钟」的漂移。
 * 音频线程被卡住时这个差值会突然变大，正对应听到的发声抖动。
 */
function recordClockSkew(ctx: AudioContext): void {
  const delta = perfNow() - ctx.currentTime * 1000;
  if (clockBaseMs === null) {
    clockBaseMs = delta;
    return;
  }
  const skew = Math.abs(delta - clockBaseMs);
  if (skew > clockSkewMaxMs) clockSkewMaxMs = Math.round(skew);
}

/** 发声排程抖动最大值（毫秒，调试面板用） */
export function audioJitterMs(): number {
  return clockSkewMaxMs;
}

export function resetAudioJitter(): void {
  clockBaseMs = null;
  clockSkewMaxMs = 0;
}

/** 开演前预热：加载当前鼓组样本，并静音跑一次建立音频节点图 */
export async function warmUpDrums(kitId?: number): Promise<void> {
  const id = kitId ?? loadKitId();
  const ctx = getAudioContext();
  primeGainPool(ctx);
  resetAudioJitter();
  await ensureKitLoaded(id);
  // 静音触发一次，让节点图与解码路径提前热起来
  for (const part of ["kick", "snare", "hihat"] as PartId[]) {
    playSample(ctx, id, part, 0, 0.0001);
  }
}

/**
 * 触发一次鼓音色。收到击打就立刻出声，不做任何排程换算。
 * @param atMs 仅用于统计（不参与发声时刻计算）
 */
export function playDrum(
  part: PartId,
  velocity = 100,
  kitId?: number,
  note?: number,
  atMs?: number,
): void {
  void atMs;
  const ctx = getAudioContext();
  recordClockSkew(ctx);
  const v = Math.max(0.25, Math.min(1, velocity / 110)) * drumGainForNote(note);

  // 采样路径：零排程立刻发声（同一帧内的多个鼓件必然落在同一个声卡周期）
  if (playSample(ctx, kitId ?? loadKitId(), part, v)) return;

  // 采样未就绪时的合成兜底
  const t = ctx.currentTime;




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
