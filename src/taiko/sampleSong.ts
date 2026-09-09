/**
 * 内置示例曲：《简单爱》四条分轨 + 鼓 MIDI，谱面屏一键载入直接试玩。
 */
import { parseMidi, type ParsedMidi } from "./midiFile";
import { getAudioContext } from "./metronome";
import { emptyStems, peakOf, type StemKind, type StemMap } from "./stems";
import vocals from "@/assets/sample/jiandanai_Vocals.mp3.asset.json";
import bass from "@/assets/sample/jiandanai_Bass.mp3.asset.json";
import drums from "@/assets/sample/jiandanai_Drums.mp3.asset.json";
import other from "@/assets/sample/jiandanai_Other.mp3.asset.json";
import midiAsset from "@/assets/sample/jiandanai.mid.asset.json";

export const SAMPLE_TITLE = "简单爱";

/** 打包成桌面端（file://）时，相对资源路径回落到线上地址 */
const ASSET_HOST = "https://drum-joy.lovable.app";

function assetUrl(url: string): string {
  if (/^https?:/i.test(url)) return url;
  if (typeof location !== "undefined" && location.protocol.startsWith("http")) return url;
  return ASSET_HOST + url;
}

const SAMPLE_STEMS: Record<StemKind, { url: string; fileName: string }> = {
  vocals: { url: assetUrl(vocals.url), fileName: "简单爱_Vocals.mp3" },
  bass: { url: assetUrl(bass.url), fileName: "简单爱_Bass.mp3" },
  drums: { url: assetUrl(drums.url), fileName: "简单爱_Drums.mp3" },
  other: { url: assetUrl(other.url), fileName: "简单爱_Other.mp3" },
};

export interface LoadedSample {
  stems: StemMap;
  midi: ParsedMidi;
  midiFileName: string;
  title: string;
}

export async function loadSampleSong(
  onProgress?: (label: string) => void,
): Promise<LoadedSample> {
  onProgress?.("下载示例曲 MIDI…");
  const midiBuf = await (await fetch(assetUrl(midiAsset.url))).arrayBuffer();
  const midi = parseMidi(midiBuf);

  const stems = emptyStems();
  const ctx = getAudioContext();
  for (const kind of Object.keys(SAMPLE_STEMS) as StemKind[]) {
    const entry = SAMPLE_STEMS[kind];
    onProgress?.(`下载并解码 ${entry.fileName}…`);
    const buf = await (await fetch(entry.url)).arrayBuffer();
    const buffer = await ctx.decodeAudioData(buf);
    stems[kind] = { buffer, fileName: entry.fileName, peak: peakOf(buffer) };
  }

  return { stems, midi, midiFileName: "简单爱.mid", title: SAMPLE_TITLE };
}
