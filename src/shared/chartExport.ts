import { DRUM_NOTE_NAMES } from "./drumLaneMap";
import type { DrumLane } from "./drumLaneMap";
import type { ChartBeatMap, ChartGrid, TaikoChart } from "./taikoChart";

export const CHART_EXPORT_FORMAT = "aerogame.chart-package" as const;
export const CHART_EXPORT_SCHEMA_VERSION = 1 as const;
export const EXPORT_DIFFICULTIES = ["easy", "beginner", "standard", "hard"] as const;

export type ExportDifficulty = (typeof EXPORT_DIFFICULTIES)[number];

export type ChartExportJson =
  | string
  | number
  | boolean
  | null
  | { [key: string]: ChartExportJson | undefined }
  | ChartExportJson[];

export interface ChartExportSourceSong {
  id: string;
  title: string;
  artist: string | null;
  durationMs: number;
  bpm: number;
  timeSignature: [number, number];
  fingerprint: string;
  /** Cover image embedded as a data URI (e.g. data:image/jpeg;base64,...), or null. */
  coverImage: string | null;
  charts: Partial<Record<ExportDifficulty, ChartExportJson>>;
}

export interface AeroGameExportNote {
  timeMs: number;
  instrument: string;
  inputLane: DrumLane;
  midiNote: number | null;
  drumName: string | null;
  big: boolean;
  holdMs?: number;
}

export interface AeroGameExportChart {
  difficulty: ExportDifficulty;
  title: string;
  bpm: number;
  timeSignature: [number, number];
  durationMs: number;
  grid?: ChartGrid;
  beatMap?: ChartBeatMap;
  notes: AeroGameExportNote[];
}

export interface AeroGameExportSong {
  id: string;
  title: string;
  artist: string | null;
  durationMs: number;
  bpm: number;
  timeSignature: [number, number];
  chartFingerprint: string;
  /** Cover PNG file name shipped next to this JSON (same folder), or null. */
  coverFile: string | null;
  charts: Record<ExportDifficulty, AeroGameExportChart>;
}

export interface AeroGameChartPackage {
  format: typeof CHART_EXPORT_FORMAT;
  schemaVersion: typeof CHART_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  timeUnit: "milliseconds";
  coordinateSystem: "song-start";
  difficultyOrder: readonly ExportDifficulty[];
  fieldGuide: {
    inputLane: "don=foot inputs, ka=hand inputs";
    beatMap: "absolute beat timestamps from song start; preferred over grid when present";
    midiNote: "General MIDI percussion note; null only when source data has no MIDI note";
  };
  songs: AeroGameExportSong[];
}

const MIDI_INSTRUMENTS: Readonly<Record<number, string>> = {
  35: "acoustic-bass-drum",
  36: "bass-drum",
  38: "acoustic-snare",
  40: "electric-snare",
  41: "low-floor-tom",
  42: "closed-hi-hat",
  43: "high-floor-tom",
  44: "pedal-hi-hat",
  45: "low-tom",
  46: "open-hi-hat",
  47: "low-mid-tom",
  48: "high-mid-tom",
  49: "crash-cymbal",
  50: "high-tom",
  51: "ride-cymbal",
  52: "chinese-cymbal",
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTaikoChart(value: unknown): value is TaikoChart {
  if (!value || typeof value !== "object") return false;
  const chart = value as Partial<TaikoChart>;
  return (
    typeof chart.title === "string" &&
    isFiniteNumber(chart.bpm) &&
    Array.isArray(chart.timeSignature) &&
    chart.timeSignature.length === 2 &&
    isFiniteNumber(chart.timeSignature[0]) &&
    isFiniteNumber(chart.timeSignature[1]) &&
    isFiniteNumber(chart.durationMs) &&
    Array.isArray(chart.notes) &&
    chart.notes.every(
      (note) =>
        Boolean(note) &&
        isFiniteNumber(note.timeMs) &&
        (note.lane === "don" || note.lane === "ka") &&
        (note.note === undefined || isFiniteNumber(note.note)) &&
        (note.holdMs === undefined || isFiniteNumber(note.holdMs)),
    )
  );
}

function exportChart(difficulty: ExportDifficulty, value: ChartExportJson | undefined): AeroGameExportChart {
  if (!isTaikoChart(value)) throw new Error(`谱面 ${difficulty} 数据格式不完整`);
  const chart = value;
  return {
    difficulty,
    title: chart.title,
    bpm: chart.bpm,
    timeSignature: chart.timeSignature,
    durationMs: chart.durationMs,
    ...(chart.grid ? { grid: chart.grid } : {}),
    ...(chart.beatMap ? { beatMap: chart.beatMap } : {}),
    notes: chart.notes
      .map((note) => {
        const midiNote = note.note ?? null;
        return {
          timeMs: note.timeMs,
          instrument: midiNote === null ? "unknown" : (MIDI_INSTRUMENTS[midiNote] ?? `midi-${midiNote}`),
          inputLane: note.lane,
          midiNote,
          drumName: midiNote === null ? null : (DRUM_NOTE_NAMES[midiNote] ?? `MIDI Note ${midiNote}`),
          big: note.big === true,
          ...(note.holdMs !== undefined ? { holdMs: note.holdMs } : {}),
        };
      })
      .sort((a, b) => a.timeMs - b.timeMs),
  };
}

export function buildChartPackage(
  sourceSongs: ChartExportSourceSong[],
  exportedAt = new Date().toISOString(),
): AeroGameChartPackage {
  if (!sourceSongs.length) throw new Error("没有可导出的歌曲");
  const usedStems = new Set<string>();
  const songs = sourceSongs.map((song) => {
    let stem = safeExportFileStem(song.title);
    if (usedStems.has(stem)) stem = `${stem}-${song.id.slice(0, 8)}`;
    usedStems.add(stem);
    const chartEntries = EXPORT_DIFFICULTIES.map((difficulty) => [
      difficulty,
      exportChart(difficulty, song.charts[difficulty]),
    ] as const);
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      durationMs: song.durationMs,
      bpm: song.bpm,
      timeSignature: song.timeSignature,
      chartFingerprint: song.fingerprint,
      coverFile: song.coverImage ? `${stem}.png` : null,
      charts: Object.fromEntries(chartEntries) as Record<ExportDifficulty, AeroGameExportChart>,
    };
  });
  return {
    format: CHART_EXPORT_FORMAT,
    schemaVersion: CHART_EXPORT_SCHEMA_VERSION,
    exportedAt,
    timeUnit: "milliseconds",
    coordinateSystem: "song-start",
    difficultyOrder: EXPORT_DIFFICULTIES,
    fieldGuide: {
      inputLane: "don=foot inputs, ka=hand inputs",
      beatMap: "absolute beat timestamps from song start; preferred over grid when present",
      midiNote: "General MIDI percussion note; null only when source data has no MIDI note",
    },
    songs,
  };
}

export function safeExportFileStem(title: string): string {
  const cleaned = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ");
  return cleaned.slice(0, 80) || "song";
}
// ================= 拆分导出：歌曲信息 + 三份独立难度谱面 =================

export const SONG_INFO_FORMAT = "aerogame.song-info" as const;
export const CHART_DATA_FORMAT = "aerogame.chart-data" as const;
/** 导出的三档：A=入门 B=标准 C=困难（轻松不导出） */
export const SPLIT_LEVELS = [
  { code: "A", difficulty: "beginner" },
  { code: "B", difficulty: "standard" },
  { code: "C", difficulty: "hard" },
] as const;

export interface SplitExportFile {
  name: string;
  text: string;
}

export interface SplitAudioNames {
  vocals?: string | null;
  others?: string | null;
  bass?: string | null;
}

export function chartFileName(stem: string, code: string): string {
  return `${stem} - ${code} - game.json`;
}

/**
 * 一首歌 → 4 份 JSON：`歌名.info.json`（歌名/歌手/速度/拍号等）+
 * `歌名 - A/B/C - game.json`（仅谱面）。谱面 durationMs 统一取歌曲音频时长。
 */
export function buildSplitExport(
  song: ChartExportSourceSong,
  stem: string,
  audio: SplitAudioNames = {},
): SplitExportFile[] {
  const durationMs = Math.round(song.durationMs);
  const charts = SPLIT_LEVELS.map(({ code, difficulty }) => {
    const c = exportChart(difficulty, song.charts[difficulty]);
    return {
      name: chartFileName(stem, code),
      text: JSON.stringify(
        {
          format: CHART_DATA_FORMAT,
          schemaVersion: CHART_EXPORT_SCHEMA_VERSION,
          songId: song.id,
          difficulty: code,
          difficultyLabel: difficulty,
          timeUnit: "milliseconds",
          coordinateSystem: "song-start",
          durationMs,
          ...(c.beatMap ? { beatMap: c.beatMap } : {}),
          ...(c.grid ? { grid: c.grid } : {}),
          notes: c.notes,
        },
        null,
        2,
      ),
    };
  });
  const info = {
    format: SONG_INFO_FORMAT,
    schemaVersion: CHART_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    id: song.id,
    title: song.title,
    artist: song.artist,
    durationMs,
    bpm: song.bpm,
    timeSignature: song.timeSignature,
    chartFingerprint: song.fingerprint,
    coverFile: song.coverImage ? `${stem}.png` : null,
    charts: Object.fromEntries(SPLIT_LEVELS.map(({ code }) => [code, chartFileName(stem, code)])),
    difficultyLabels: { A: "beginner", B: "standard", C: "hard" },
    audioTracks: {
      vocals: audio.vocals ?? null,
      others: audio.others ?? null,
      bass: audio.bass ?? null,
    },
  };
  return [{ name: `${stem}.info.json`, text: JSON.stringify(info, null, 2) }, ...charts];
}
