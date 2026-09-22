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

/**
 * 同时发声上限按平台区分：
 * iOS 音频线程对同时活跃的 BufferSource 更敏感（密集段容易突发卡顿），
 * 桌面余量大可以多留一点尾音。
 */
const VOICE_LIMITS = isIOS()
  ? { perPart: 4, total: 12 }
  : isAndroid()
    ? { perPart: 4, total: 14 }
    : { perPart: 4, total: 16 };
/** 单个鼓件最多同时发声数（连打时掐掉最早那一声的尾巴） */
const MAX_VOICES_PER_PART = VOICE_LIMITS.perPart;
/** 全局最多同时发声数（密集段防止音频线程被压满） */
const MAX_VOICES_TOTAL = VOICE_LIMITS.total;
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
    // 单段快速收尾：不取消旧排程、不查当前值，密集段少给音频线程添活
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0.0001, t + CHOKE_SEC);
    v.src.stop(t + CHOKE_SEC + 0.01);
  } catch {
    // 已停止
  }
}

/**
 * 音量节点池：每敲一下都 createGain + connect + 回收，在密集段是可观的
 * 临时对象开销。这里复用固定一批节点，只改增益值。
 */
const gainPool: GainNode[] = [];

function takeGain(ctx: AudioContext, value: number): GainNode {
  const node = gainPool.pop() ?? ctx.createGain();
  try {
    node.gain.cancelScheduledValues(ctx.currentTime);
  } catch {
    // 忽略
  }
  node.gain.value = value;
  if (node.context !== ctx) {
    const fresh = ctx.createGain();
    fresh.gain.value = value;
    return fresh;
  }
  node.connect(bus(ctx));
  return node;
}

function recycleGain(node: GainNode): void {
  try {
    node.disconnect();
  } catch {
    // 忽略
  }
  if (gainPool.length < 32) gainPool.push(node);
}

/** 预建一批音量节点，开演前热起来 */
function primeGainPool(ctx: AudioContext): void {
  while (gainPool.length < 16) gainPool.push(ctx.createGain());
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
  const g = takeGain(ctx, v);
  src.connect(g);
  src.start(t);
  const voice: Voice = { part, src, gain: g, at: t };
  voices.push(voice);
  // 回收不在敲击那一瞬间做，攒起来在空闲时批量处理
  src.onended = () => queueRetire(voice);
  return true;
}

/** 发声结束后的回收队列（避免密集段在主线程上零散做清理） */
const retireQueue: Voice[] = [];
let retireScheduled = false;

function flushRetire(): void {
  retireScheduled = false;
  for (const v of retireQueue.splice(0, retireQueue.length)) {
    dropVoice(v);
    try {
      v.src.disconnect();
    } catch {
      // 已断开
    }
    recycleGain(v.gain);
  }
}

function queueRetire(v: Voice): void {
  retireQueue.push(v);
  if (retireScheduled) return;
  retireScheduled = true;
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (idle) idle(flushRetire);
  else setTimeout(flushRetire, 50);
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
 * 发声时间预算（秒）。
 * 过去排程时刻是「调用那一刻 + 10ms」，主线程忙一下（长帧、垃圾回收、宿主
 * 批量投递）这段耽误就 1:1 变成听感延迟 —— 判定还是 PERFECT，声音偶尔慢半下。
 * 现在改成「**真实敲击时刻** + 固定预算」：耽误没超预算时，声音落在同一个
 * 绝对时间点上，忽快忽慢被吸收掉；超预算就立刻发声（不做补偿性提前）。
 */
export const HIT_LOOKAHEAD_SEC = 0.022;
const HIT_BUDGET_MIN = 0.018;
const HIT_BUDGET_MAX = 0.03;
/** 立即发声时至少留的提前量，避免排到过去的时刻 */
const MIN_LEAD_SEC = 0.004;

let hitBudgetSec = HIT_LOOKAHEAD_SEC;

/** 开演时按输出缓冲长度定一次预算（只算一次，之后恒定） */
export function initHitLookahead(ctx: AudioContext): void {
  const base = Number(ctx.baseLatency ?? 0);
  const want = Number.isFinite(base) && base > 0 ? base + 0.012 : HIT_LOOKAHEAD_SEC;
  hitBudgetSec = Math.max(HIT_BUDGET_MIN, Math.min(HIT_BUDGET_MAX, want));
}

/** 当前预算（毫秒，调试面板用） */
export function currentLookaheadMs(): number {
  return Math.round(hitBudgetSec * 1000);
}

// ---------------- 敲击时刻 → 音频时钟 ----------------

let hitDelayLastMs = 0;
let hitDelayPeakMs = 0;

/** 敲击→发声耽误：当前值（毫秒，调试面板用） */
export function hitDelayMs(): number {
  return hitDelayLastMs;
}

/** 敲击→发声耽误：峰值（毫秒，调试面板用） */
export function hitDelayPeak(): number {
  return hitDelayPeakMs;
}

/**
 * performance.now() 基准的敲击时刻 → ctx 时间轴。
 * 有 getOutputTimestamp() 时用它给出的 contextTime/performanceTime 配对，
 * 比直接读 currentTime 更贴近真实输出位置。
 */
function mapToCtxTime(ctx: AudioContext, atMs: number): number {
  const nowPerf = perfNow();
  let ctxNow = ctx.currentTime;
  try {
    const ts = ctx.getOutputTimestamp?.();
    const ct = ts?.contextTime;
    const pt = ts?.performanceTime;
    if (ct !== undefined && pt !== undefined && Number.isFinite(ct) && Number.isFinite(pt)) {
      ctxNow = ct + (nowPerf - pt) / 1000;
    }
  } catch {
    // 不支持时退回 currentTime
  }
  return ctxNow - (nowPerf - atMs) / 1000;
}

/** 时间戳明显不可信（音频时钟刚挂起/恢复）时的容忍上限（秒） */
const STALE_LIMIT_SEC = 0.06;

/** 排程时刻：敲击时刻 + 预算；来不及就立刻发声 */
function scheduleTime(ctx: AudioContext, atMs?: number): number {
  const now = ctx.currentTime;
  if (atMs === undefined || !Number.isFinite(atMs)) return now + hitBudgetSec;
  const delay = Math.max(0, perfNow() - atMs);
  hitDelayLastMs = Math.round(delay);
  if (hitDelayLastMs > hitDelayPeakMs) hitDelayPeakMs = hitDelayLastMs;
  const want = mapToCtxTime(ctx, atMs) + hitBudgetSec;
  // 两条时钟对不上（挂起/恢复后 currentTime 停过）时别死抱着一个过去的时刻，
  // 退回「现在 + 预算」，保持稳定的一点提前量而不是贴着缓冲边缘发声。
  if (!Number.isFinite(want) || want < now - STALE_LIMIT_SEC) return now + hitBudgetSec;
  return Math.max(now + MIN_LEAD_SEC, want);
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
  hitDelayLastMs = 0;
  hitDelayPeakMs = 0;
}

/** 开演前预热：加载当前鼓组样本，并静音跑一次建立音频节点图 */
export async function warmUpDrums(kitId?: number): Promise<void> {
  const id = kitId ?? loadKitId();
  const ctx = getAudioContext();
  initHitLookahead(ctx);
  primeGainPool(ctx);
  resetAudioJitter();
  await ensureKitLoaded(id);
  // 静音触发一次，让节点图与解码路径提前热起来
  for (const part of ["kick", "snare", "hihat"] as PartId[]) {
    playSample(ctx, id, part, ctx.currentTime + hitBudgetSec, 0.0001);
  }
}

/**
 * @param atMs 真实敲击时刻（performance.now() 基准）；给了就按它排程
 */
export function playDrum(
  part: PartId,
  velocity = 100,
  kitId?: number,
  note?: number,
  atMs?: number,
): void {
  const ctx = getAudioContext();
  recordClockSkew(ctx);
  const t = scheduleTime(ctx, atMs);
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
