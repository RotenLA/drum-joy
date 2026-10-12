// 读取 AeroGame 拆分导出：歌名.info.json + 歌名 - A|B|C - game.json
export interface SongInfo {
  format: "aerogame.song-info";
  schemaVersion: 1;
  id: string;
  title: string;
  artist: string | null;
  durationMs: number;
  bpm: number;
  timeSignature: [number, number];
  chartFingerprint: string;
  coverFile: string | null;
  charts: Record<"A" | "B" | "C", string>;
  audioTracks: { vocals: string | null; others: string | null; bass: string | null };
}

export interface ChartData {
  format: "aerogame.chart-data";
  schemaVersion: 1;
  difficulty: "A" | "B" | "C";
  durationMs: number;
  beatMap?: { beats: number[]; beatsPerBar: number; barPhase: number };
  grid?: { originMs: number; stepMs: number; stepsPerBeat: number; stepsPerBar: number };
  notes: {
    timeMs: number;
    midiNote: number | null;
  }[];
}

export function readSongInfo(text: string): SongInfo {
  const info = JSON.parse(text) as SongInfo;
  if (info.format !== "aerogame.song-info" || info.schemaVersion !== 1) throw new Error("不支持的歌曲信息格式");
  return info;
}

export function readChart(text: string): ChartData {
  const chart = JSON.parse(text) as ChartData;
  if (chart.format !== "aerogame.chart-data" || chart.schemaVersion !== 1) throw new Error("不支持的谱面格式");
  return { ...chart, notes: [...chart.notes].sort((a, b) => a.timeMs - b.timeMs) };
}

/** 用法：const file = info.charts.B; const chart = readChart(await load(file)); */
