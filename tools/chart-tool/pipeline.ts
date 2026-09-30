/**
 * 本地谱面工具的单曲处理流程：与后台上传完全同一套算法（src/taiko/*），不另写一份。
 */
import { parseMidi } from "@/taiko/midiFile";
import { buildAllCharts, chartVersionFingerprint } from "@/taiko/adminChartBuild";
import { decodeAndAnalyzeTempo } from "@/taiko/audioTempo";
import { analyzeMetroFile, toChartBeatMap } from "@/taiko/metroAnalysis";
import { readAudioMeta } from "@/taiko/audioMeta";
import type { FolderImportSong } from "@/taiko/adminFolderImport";
import type { ChartBeatMap } from "@/shared/taikoChart";
import {
  buildChartPackage,
  safeExportFileStem,
  type ChartExportJson,
  type ChartExportSourceSong,
} from "@/shared/chartExport";

export interface SongOutput {
  title: string;
  bpm: number;
  jsonName: string;
  jsonText: string;
  pngName: string | null;
  png: Uint8Array | null;
}

async function audioDurationMs(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve) => {
      const el = document.createElement("audio");
      el.preload = "metadata";
      el.onloadedmetadata = () => resolve((el.duration || 0) * 1000);
      el.onerror = () => resolve(0);
      el.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

async function toPng(blob: Blob): Promise<Uint8Array> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!out) throw new Error("封面转换 PNG 失败");
    return new Uint8Array(await out.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function stableId(title: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(title));
  const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function processSong(
  song: FolderImportSong,
  onStep: (text: string) => void,
): Promise<SongOutput> {
  const files = song.files;
  const midi = files.midi;
  if (!midi) throw new Error("缺少 MIDI 文件");

  let title = song.title;
  let artist: string | null = song.artist ?? null;
  let coverBlob: Blob | null = null;
  if (files.original) {
    onStep("读取原曲信息");
    const meta = await readAudioMeta(files.original);
    if (meta.artist && !artist) artist = meta.artist;
    if (meta.cover) coverBlob = meta.cover.blob;
  }
  if (!title) throw new Error("缺少歌名");

  onStep("解析 MIDI");
  const sourceMidi = parseMidi(await midi.arrayBuffer());

  let beatMap: ChartBeatMap | null = null;
  let metroBpm = 0;
  let metroBeatsPerBar = 0;
  if (files.metro) {
    onStep("解析 Metro 轨");
    const ctx = new AudioContext();
    try {
      const analysis = await analyzeMetroFile(files.metro, ctx);
      if (analysis) {
        beatMap = toChartBeatMap(analysis);
        metroBpm = analysis.bpm;
        metroBeatsPerBar = analysis.beatsPerBar;
      }
    } finally {
      void ctx.close();
    }
    if (!beatMap) throw new Error("Metro 轨解析失败：没有检测到稳定的脉冲");
  }

  let parsed = sourceMidi;
  let displayBpm = metroBpm;
  if (!beatMap) {
    const audio = files.drums ?? files.other ?? files.bass ?? files.vocals;
    if (audio) {
      onStep("分析音频速度");
      const tempo = await decodeAndAnalyzeTempo(audio, sourceMidi);
      parsed = tempo.midi;
      displayBpm = tempo.bpm;
    } else {
      displayBpm = sourceMidi.bpm;
    }
  }

  onStep("生成四档谱面");
  const charts = buildAllCharts(parsed, title, displayBpm, beatMap);
  const fingerprint = chartVersionFingerprint(parsed, beatMap);
  let durationMs = parsed.durationMs;
  for (const key of ["vocals", "bass", "drums", "other", "original"] as const) {
    const f = files[key];
    if (f) durationMs = Math.max(durationMs, await audioDurationMs(f));
  }

  const bpm = Math.round(displayBpm * 10) / 10;
  const source: ChartExportSourceSong = {
    id: await stableId(title),
    title,
    artist,
    durationMs: Math.round(durationMs),
    bpm,
    timeSignature: [metroBeatsPerBar || parsed.timeSignature[0], beatMap ? 4 : parsed.timeSignature[1]],
    fingerprint,
    coverImage: coverBlob ? "embedded" : null,
    charts: Object.fromEntries(
      charts.map((c) => [c.difficulty, JSON.parse(JSON.stringify(c.chart)) as ChartExportJson]),
    ),
  };

  let png: Uint8Array | null = null;
  if (coverBlob) {
    onStep("导出封面");
    png = await toPng(coverBlob).catch(() => null);
    if (!png) source.coverImage = null;
  }
  const pack = buildChartPackage([source]);
  const stem = safeExportFileStem(title);
  return {
    title,
    bpm,
    jsonName: `${stem}.aerogame-chart.json`,
    jsonText: JSON.stringify(pack, null, 2),
    pngName: png ? `${stem}.png` : null,
    png,
  };
}
