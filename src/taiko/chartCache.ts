/**
 * 谱面固化缓存：同一首歌（文件名 + MIDI 内容指纹）+ 同一档难度，
 * 无论刷新还是重开 app，拿到的都是同一份谱面。
 *
 * 生成本身是确定性的，缓存额外保证「输入的边角参数变化（音频时长等）」
 * 不会让谱面漂移，同时省掉重复分析开销。
 */
import type { TaikoChart } from "@/shared/taikoChart";
import type { ParsedMidi } from "./midiFile";
import { buildPlayChart, type Difficulty } from "./difficulty";
import type { PlayChartOptions } from "./difficulty";

const CACHE_KEY = "taiko.charts.v10";
const CHART_ALGORITHM_VERSION = "gm-difficulty-snap-v3";
/** 最多保留的歌曲份数（按最近使用淘汰） */
const MAX_SONGS = 5;

interface CacheEntry {
  /** 最近使用时间戳，用于淘汰 */
  usedAt: number;
  charts: Partial<Record<string, TaikoChart>>;
}

type CacheFile = Record<string, CacheEntry>;

/** MIDI 内容指纹：ppq + 全部音符（tick / note / velocity）的 FNV-1a 哈希 */
export function midiFingerprint(midi: ParsedMidi): string {
  let h = 0x811c9dc5;
  const push = (n: number) => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  push(midi.ppq);
  push(midi.notes.length);
  for (const n of midi.notes) {
    push(n.tick);
    push(n.note);
    push(n.velocity);
  }
  return (h >>> 0).toString(36);
}

/** 云端谱面/下载版本：内容指纹之外纳入重新推算后的变速表。 */
export function chartVersionFingerprint(midi: ParsedMidi): string {
  let version = `${midiFingerprint(midi)}.${CHART_ALGORITHM_VERSION}`;
  for (const tempo of midi.tempos) {
    version += `.${tempo.tick.toString(36)}-${Math.round(tempo.usPerQuarter).toString(36)}`;
  }
  return version;
}

function readCache(): CacheFile {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheFile) : {};
  } catch {
    return {};
  }
}

function writeCache(file: CacheFile): void {
  try {
    // 超出上限时淘汰最久未使用的歌曲
    const keys = Object.keys(file);
    if (keys.length > MAX_SONGS) {
      keys
        .sort((a, b) => (file[a]?.usedAt ?? 0) - (file[b]?.usedAt ?? 0))
        .slice(0, keys.length - MAX_SONGS)
        .forEach((k) => delete file[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(file));
  } catch {
    // 存储不可用（或超配额）时仅走内存生成
  }
}

function songKey(fileName: string, midi: ParsedMidi): string {
  return `${fileName}#${midiFingerprint(midi)}`;
}

/**
 * 云端固化谱面（后台上传时预生成）：命中时客户端不再自己生成，
 * 保证所有用户、所有设备打同一首歌拿到完全一致的谱面。
 */
const cloudCharts = new Map<string, Partial<Record<string, TaikoChart>>>();

export function registerCloudCharts(
  fileName: string,
  midi: ParsedMidi,
  charts: Partial<Record<string, TaikoChart>>,
): void {
  if (!Object.keys(charts).length) return;
  cloudCharts.set(songKey(fileName, midi), charts);
}

function variantKey(diff: Difficulty, opts: PlayChartOptions): string {
  return `${diff}|${opts.phaseBeatOffset ?? 0}|${opts.offsetMs ?? 0}`;
}

/**
 * 取（或生成并固化）谱面。时长一律以 MIDI 为准，音频只用于播放，
 * 避免解码时长的细微差异让谱面每次不同。
 */
export function getPlayChart(
  midi: ParsedMidi,
  opts: PlayChartOptions,
  diff: Difficulty,
): TaikoChart {
  const sk = songKey(opts.title, midi);
  const vk = variantKey(diff, opts);

  // 未手动微调偏移时优先用云端固化谱面
  if (!opts.offsetMs && !opts.phaseBeatOffset) {
    const cloud = cloudCharts.get(sk)?.[diff];
    if (cloud) return cloud;
  }

  const file = readCache();
  const hit = file[sk]?.charts[vk];
  if (hit) {
    file[sk]!.usedAt = Date.now();
    writeCache(file);
    return hit;
  }

  const chart = buildPlayChart(midi, { ...opts, durationMs: undefined }, diff);
  const entry = file[sk] ?? { usedAt: Date.now(), charts: {} };
  entry.usedAt = Date.now();
  entry.charts[vk] = chart;
  file[sk] = entry;
  writeCache(file);
  return chart;
}

/** 清掉某首歌的全部固化谱面（谱面屏「重新生成谱面」用） */
export function clearChartCache(fileName: string, midi: ParsedMidi): void {
  const file = readCache();
  delete file[songKey(fileName, midi)];
  writeCache(file);
}
