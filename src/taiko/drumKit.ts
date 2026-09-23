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

// ---------------- 采样回放（极轻量单音通道） ----------------

/**
 * 路线 B：内嵌 WebView 里音频线程算力有限，因此按硬件鼓机的做法收敛：
 *  - 同一个鼓件严格单音：再敲一下立刻掐掉自己上一声（真鼓敲击也会阻尼上一次震动）；
 *  - 全局最多 6 声同时混音，超出时先掐最早那一声（FIFO）；
 *  - 采样未就绪就静音，不再临时建振荡器/滤波器做合成兜底；
 *  - 采样 → 固定音量节点 → 主输出，start(0) 立即出声，不做任何排程换算。
 */
const MAX_TOTAL_VOICES = 6;
/** 掐音用的极短淡出，避免硬切产生爆音 */
const CHOKE_SEC = 0.006;

interface Voice {
  part: PartId;
  src: AudioBufferSourceNode;
  g: GainNode;
  dead: boolean;
}

/** 按发声顺序排列的活动声音（长度极小，最多 6） */
const voices: Voice[] = [];

function killVoice(ctx: AudioContext, v: Voice): void {
  if (v.dead) return;
  v.dead = true;
  const t = ctx.currentTime;
  try {
    v.g.gain.setValueAtTime(v.g.gain.value, t);
    v.g.gain.linearRampToValueAtTime(0, t + CHOKE_SEC);
    v.src.stop(t + CHOKE_SEC);
  } catch {
    // 已停止
  }
}

function removeVoice(v: Voice): void {
  const i = voices.indexOf(v);
  if (i >= 0) voices.splice(i, 1);
}

function playSample(ctx: AudioContext, kitId: number, part: PartId, v: number): boolean {
  const buf = buffers.get(`${kitId}:${part}`);
  if (!buf) {
    void ensureKitLoaded(kitId);
    return false;
  }

  // 同鼓件单音：先掐自己的上一声
  for (let i = voices.length - 1; i >= 0; i--) {
    const old = voices[i]!;
    if (old.part === part) killVoice(ctx, old);
  }
  // 全局并发上限：掐最早的一声
  let live = 0;
  for (const x of voices) if (!x.dead) live++;
  while (live >= MAX_TOTAL_VOICES) {
    const oldest = voices.find((x) => !x.dead);
    if (!oldest) break;
    killVoice(ctx, oldest);
    live--;
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = v;
  src.connect(g);
  g.connect(bus(ctx));
  src.start(0);
  const voice: Voice = { part, src, g, dead: false };
  voices.push(voice);
  src.onended = () => {
    voice.dead = true;
    removeVoice(voice);
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
  let n = 0;
  for (const v of voices) if (!v.dead) n++;
  return n;
}

let master: GainNode | null = null;

function bus(ctx: AudioContext): GainNode {
  if (!master || master.context !== ctx) {
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  return master;
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
  bus(ctx);
  resetAudioJitter();
  await ensureKitLoaded(id);
  // 静音触发一次，让节点图与解码路径提前热起来
  for (const part of ["kick", "snare", "hihat"] as PartId[]) {
    playSample(ctx, id, part, 0.0001);
  }
}

/**
 * 触发一次鼓音色。收到击打就立刻出声，不做任何排程换算。
 * 采样未就绪时保持静音（不再临时建振荡器/滤波器合成，避免移动端算力开销与失谐）。
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
  playSample(ctx, kitId ?? loadKitId(), part, v);
}

