/**
 * 五首预设曲：四条 stem 音轨 + 鼓 MIDI 都托管在 CDN，
 * 谱面屏直接点歌加载（只对外暴露一个总百分比进度）。
 */
import { parseMidi, type ParsedMidi } from "./midiFile";
import { getAudioContext } from "./metronome";
import { emptyStems, peakOf, STEM_KINDS, STEM_LABEL, type StemKind, type StemMap } from "./stems";




import hongseVocals from "@/assets/songs/hongse-gaogenxie_Vocals.mp3.asset.json";
import hongseBass from "@/assets/songs/hongse-gaogenxie_Bass.mp3.asset.json";
import hongseDrums from "@/assets/songs/hongse-gaogenxie_Drums.mp3.asset.json";
import hongseOther from "@/assets/songs/hongse-gaogenxie_Other.mp3.asset.json";
import hongseMidi from "@/assets/songs/hongse-gaogenxie.mid.asset.json";

import libaiVocals from "@/assets/songs/libai_Vocals.mp3.asset.json";
import libaiBass from "@/assets/songs/libai_Bass.mp3.asset.json";
import libaiDrums from "@/assets/songs/libai_Drums.mp3.asset.json";
import libaiOther from "@/assets/songs/libai_Other.mp3.asset.json";
import libaiMidi from "@/assets/songs/libai.mid.asset.json";

import alaylmVocals from "@/assets/songs/as-long-as-you-love-me_Vocals.mp3.asset.json";
import alaylmBass from "@/assets/songs/as-long-as-you-love-me_Bass.mp3.asset.json";
import alaylmDrums from "@/assets/songs/as-long-as-you-love-me_Drums.mp3.asset.json";
import alaylmOther from "@/assets/songs/as-long-as-you-love-me_Other.mp3.asset.json";
import alaylmMidi from "@/assets/songs/as-long-as-you-love-me.mid.asset.json";

import creepinVocals from "@/assets/songs/creepin-up-on-you_Vocals.mp3.asset.json";
import creepinBass from "@/assets/songs/creepin-up-on-you_Bass.mp3.asset.json";
import creepinDrums from "@/assets/songs/creepin-up-on-you_Drums.mp3.asset.json";
import creepinOther from "@/assets/songs/creepin-up-on-you_Other.mp3.asset.json";
import creepinMidi from "@/assets/songs/creepin-up-on-you.mid.asset.json";

interface AssetPointer {
  url: string;
  size: number;
}

export interface PresetSong {
  id: string;
  title: string;
  stems: Record<StemKind, AssetPointer>;
  midi: AssetPointer;
}

export const PRESET_SONGS: readonly PresetSong[] = [
  {

    id: "hongse-gaogenxie",
    title: "红色高跟鞋",
    stems: { vocals: hongseVocals, bass: hongseBass, drums: hongseDrums, other: hongseOther },
    midi: hongseMidi,
  },
  {
    id: "libai",
    title: "李白",
    stems: { vocals: libaiVocals, bass: libaiBass, drums: libaiDrums, other: libaiOther },
    midi: libaiMidi,
  },
  {
    id: "as-long-as-you-love-me",
    title: "As Long As You Love Me",
    stems: { vocals: alaylmVocals, bass: alaylmBass, drums: alaylmDrums, other: alaylmOther },
    midi: alaylmMidi,
  },
  {
    id: "creepin-up-on-you",
    title: "Creepin' Up On You",
    stems: {
      vocals: creepinVocals,
      bass: creepinBass,
      drums: creepinDrums,
      other: creepinOther,
    },
    midi: creepinMidi,
  },
];

/** 打包成桌面端（file://）时，相对资源路径回落到线上地址 */
const ASSET_HOST = "https://drum-joy.lovable.app";

function assetUrl(url: string): string {
  if (/^https?:/i.test(url)) return url;
  if (typeof location !== "undefined" && location.protocol.startsWith("http")) return url;
  return ASSET_HOST + url;
}

/** 带字节进度的下载 */
async function fetchWithProgress(
  url: string,
  onBytes: (delta: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(assetUrl(url));
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
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

export interface LoadedPreset {
  stems: StemMap;
  midi: ParsedMidi;
  midiFileName: string;
  title: string;
}

/**
 * 加载一首预设曲。onProgress 只给 0~100 的百分比（下载占 92%，解码占剩余）。
 */
export async function loadPresetSong(
  song: PresetSong,
  onProgress?: (percent: number) => void,
): Promise<LoadedPreset> {
  const totalBytes =
    song.midi.size + STEM_KINDS.reduce((sum, k) => sum + (song.stems[k]?.size ?? 0), 0);
  let done = 0;
  const bump = (delta: number) => {
    done += delta;
    onProgress?.(Math.min(92, (done / Math.max(1, totalBytes)) * 92));
  };

  const midiBuf = await fetchWithProgress(song.midi.url, bump);
  const midi = parseMidi(midiBuf);

  const raw: Partial<Record<StemKind, ArrayBuffer>> = {};
  for (const kind of STEM_KINDS) {
    const ptr = song.stems[kind];
    if (!ptr) continue;
    raw[kind] = await fetchWithProgress(ptr.url, bump);
  }

  const ctx = getAudioContext();
  const stems = emptyStems();
  let decoded = 0;
  const kinds = STEM_KINDS.filter((k) => raw[k]);
  for (const kind of kinds) {
    const buffer = await ctx.decodeAudioData(raw[kind]!);
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
