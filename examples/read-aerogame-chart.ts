import type { AeroGameChartPackage, ExportDifficulty } from "../src/shared/chartExport";

export function readAeroGameChart(
  jsonText: string,
  difficulty: ExportDifficulty = "standard",
) {
  const pack = JSON.parse(jsonText) as Partial<AeroGameChartPackage>;
  if (pack.format !== "aerogame.chart-package" || pack.schemaVersion !== 1) {
    throw new Error("不支持的 AeroGame 谱面格式或版本");
  }
  const song = pack.songs?.[0];
  if (!song) throw new Error("谱面包中没有歌曲");
  const chart = song.charts[difficulty];
  return {
    song,
    chart,
    notesInPlaybackOrder: [...chart.notes].sort((a, b) => a.timeMs - b.timeMs),
    beatTimesMs: chart.beatMap?.beats ?? [],
    // 封面 PNG 与 JSON 同目录，用 coverFile 配对；为 null 时用游戏内默认封面
    coverFile: song.coverFile,
  };
}
