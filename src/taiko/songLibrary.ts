/**
 * 云端曲库：歌曲列表来自后台上传的库，音频/MIDI 走签名直链下载，
 * 四档谱面在后台上传时已预生成，这里直接取回并固化，保证所有人打同一份谱。
 */
import { parseMidi, type ParsedMidi } from "./midiFile";
import { getAudioContext } from "./metronome";
import { emptyStems, peakOf, STEM_KINDS, STEM_LABEL, type StemKind, type StemMap } from "./stems";
import { registerCloudCharts } from "./chartCache";
import type { TaikoChart } from "@/shared/taikoChart";
import { listLibrarySongs, getSongAssets, type LibrarySong } from "@/lib/songs.functions";

export type { LibrarySong };

export async function fetchLibrarySongs(): Promise<LibrarySong[]> {
  const { songs } = await listLibrarySongs();
  return songs;
}

export interface LoadedLibrarySong {
  stems: StemMap;
  midi: ParsedMidi;
  midiFileName: string;
  title: string;
}

async function fetchWithProgress(
  url: string,
  label: string,
  onBytes: (delta: number) => void,
): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new Error(`${label} 网络下载失败`, { cause });
  }
  if (!res.ok) throw new Error(`${label} 下载失败 (${res.status})`);
  const body = res.body;
  if (!body) {
    const buf = await res.arrayBuffer();
    onBytes(buf.byteLength);
    return buf;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      onBytes(value.byteLength);
    }
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

/** 下载 + 解码一首库内歌曲；onProgress 给 0~100 百分比 */
export async function loadLibrarySong(
  song: LibrarySong,
  onProgress?: (percent: number) => void,
): Promise<LoadedLibrarySong> {
  const assets = await getSongAssets({ data: { id: song.id } });

  const totalBytes =
    Object.values(assets.sizes).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  let done = 0;
  const bump = (delta: number) => {
    done += delta;
    onProgress?.(Math.min(92, (done / totalBytes) * 92));
  };

  const midiBuf = await fetchWithProgress(assets.urls.midi, "MIDI", bump);
  let midi: ParsedMidi;
  try {
    midi = parseMidi(midiBuf);
  } catch (cause) {
    throw new Error("MIDI 文件解析失败", { cause });
  }

  // 云端固化谱面：命中后客户端不再自己生成
  const cloud: Partial<Record<string, TaikoChart>> = {};
  for (const [diff, chart] of Object.entries(assets.charts)) {
    if (chart) cloud[diff] = chart as TaikoChart;
  }
  registerCloudCharts(song.title, midi, cloud);

  const raw: Partial<Record<StemKind, ArrayBuffer>> = {};
  for (const kind of STEM_KINDS) {
    const url = assets.urls[kind];
    if (!url) continue;
    raw[kind] = await fetchWithProgress(url, STEM_LABEL[kind], bump);
  }

  const ctx = getAudioContext();
  const stems = emptyStems();
  let decoded = 0;
  const kinds = STEM_KINDS.filter((k) => raw[k]);
  for (const kind of kinds) {
    const source = raw[kind];
    if (!source) continue;
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(source);
    } catch (cause) {
      throw new Error(`${STEM_LABEL[kind]}音频解码失败`, { cause });
    }
    stems[kind] = {
      buffer,
      fileName: `${song.title}_${STEM_LABEL[kind]}.mp3`,
      peak: peakOf(buffer),
    };
    decoded++;
    onProgress?.(92 + (decoded / Math.max(1, kinds.length)) * 8);
  }

  onProgress?.(100);
  return { stems, midi, midiFileName: `${song.title}.mid`, title: song.title };
}


/** 从本地已下载的原始文件解码成可播放歌曲（只解码当前这一首） */
export async function decodeStoredSong(
  song: LibrarySong,
  stored: import("./songDownloads").StoredSong,
): Promise<LoadedLibrarySong> {
  let midi: ParsedMidi;
  try {
    midi = parseMidi(stored.midi.slice(0));
  } catch (cause) {
    throw new Error("MIDI 文件解析失败", { cause });
  }
  const cloud: Partial<Record<string, TaikoChart>> = {};
  for (const [diff, chart] of Object.entries(stored.charts)) {
    if (chart) cloud[diff] = chart as TaikoChart;
  }
  registerCloudCharts(song.title, midi, cloud);
  const ctx = getAudioContext();
  const stems = emptyStems();
  for (const kind of STEM_KINDS) {
    const src = stored.stems[kind];
    if (!src) continue;
    // decodeAudioData 会转移缓冲区所有权，传副本以保留本地存储对象
    const buffer = await ctx.decodeAudioData(src.slice(0));
    stems[kind] = { buffer, fileName: `${song.title}_${STEM_LABEL[kind]}.mp3`, peak: peakOf(buffer) };
  }
  return { stems, midi, midiFileName: `${song.title}.mid`, title: song.title };
}
