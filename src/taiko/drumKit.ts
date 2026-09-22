/**
 * 本地鼓音色：优先播放真实采样（9 套鼓组，后台按需加载），
 * 采样未就绪或加载失败时自动退回 WebAudio 合成音，保证一定有声音。
 *
 * 默认开启，可在谱面页全局参数里关闭；开关与鼓组选择都存 localStorage。
 */
import { getAudioContext } from "./metronome";
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
  if (buffers.has(`${kitId}:kick`)) return;
  loading.add(kitId);
  const ctx = getAudioContext();
  await Promise.all(
    Object.entries(kit).map(async ([part, urls]) => {
      try {
        const res = await fetch(urls.m4a);
        const raw = await res.arrayBuffer();
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

// ---------------- 发声数量控制 ----------------

/** 单个鼓件最多同时发声数（连打时掐掉最早那一声的尾巴） */
const MAX_VOICES_PER_PART = 3;
/** 全局最多同时发声数（密集段防止音频线程被压满） */
const MAX_VOICES_TOTAL = 14;
/** 掐音淡出时长（秒），足够短听不出断口 */
const CHOKE_SEC = 0.035;

interface Voice {
  part: PartId;
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** 排程时刻（ctx 秒），用于挑最早那一声 */
  at: number;
}

const voices: Voice[] = [];

function choke(ctx: AudioContext, v: Voice): void {
  const t = ctx.currentTime;
  try {
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), t);
    v.gain.gain.linearRampToValueAtTime(0.0001, t + CHOKE_SEC);
    v.src.stop(t + CHOKE_SEC + 0.01);
  } catch {
    // 已停止
  }
}

function dropVoice(v: Voice): void {
  const i = voices.indexOf(v);
  if (i >= 0) voices.splice(i, 1);
}

/** 新的一声排程前，按「每鼓件上限 + 全局上限」掐掉最早的旧声 */
function makeRoom(ctx: AudioContext, part: PartId): void {
  let same = voices.filter((v) => v.part === part);
  while (same.length >= MAX_VOICES_PER_PART) {
    const oldest = same.reduce((a, b) => (a.at <= b.at ? a : b));
    choke(ctx, oldest);
    dropVoice(oldest);
    same = same.filter((v) => v !== oldest);
  }
  while (voices.length >= MAX_VOICES_TOTAL) {
    const oldest = voices.reduce((a, b) => (a.at <= b.at ? a : b));
    choke(ctx, oldest);
    dropVoice(oldest);
  }
}

function playSample(ctx: AudioContext, kitId: number, part: PartId, t: number, v: number): boolean {
  const buf = buffers.get(`${kitId}:${part}`);
  if (!buf) {
    void ensureKitLoaded(kitId);
    return false;
  }
  makeRoom(ctx, part);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = v;
  src.connect(g);
  g.connect(bus(ctx));
  src.start(t);
  const voice: Voice = { part, src, gain: g, at: t };
  voices.push(voice);
  src.onended = () => {
    dropVoice(voice);
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
  return voices.length;
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
 * @param note 原始 MIDI 键位，用于逐键位响度衰减
 */
/**
 * 敲击发声的固定前瞻（秒）。
 * 原来是「立刻播」（+1ms），音频线程忙的时候这一声会被推到下一个音频块，
 * 表现为偶发的延迟尖峰。统一提前 10ms 排程后总延迟恒定、不再随忙闲抖动；
 * 这 10ms 已包含在 calibration.ts 的默认 judge/visual 偏移里，手感不变。
 */
export const HIT_LOOKAHEAD_SEC = 0.01;

/** 开演前预热：加载当前鼓组样本，并静音跑一次建立音频节点图 */
export async function warmUpDrums(kitId?: number): Promise<void> {
  const id = kitId ?? loadKitId();
  const ctx = getAudioContext();
  await ensureKitLoaded(id);
  // 静音触发一次，让节点图与解码路径提前热起来
  for (const part of ["kick", "snare", "hihat"] as PartId[]) {
    playSample(ctx, id, part, ctx.currentTime + HIT_LOOKAHEAD_SEC, 0.0001);
  }
}

export function playDrum(part: PartId, velocity = 100, kitId?: number, note?: number): void {
  const ctx = getAudioContext();
  const t = ctx.currentTime + HIT_LOOKAHEAD_SEC;
  const v = Math.max(0.25, Math.min(1, velocity / 110)) * drumGainForNote(note);

  if (playSample(ctx, kitId ?? loadKitId(), part, t, v)) return;

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
