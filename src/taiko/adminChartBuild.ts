/**
 * 后台上传时预生成四档谱面：与游玩端完全同一套生成代码，
 * 所以库里存的谱面就是玩家实际打到的谱面。
 */
import { buildPlayChart, DIFFICULTIES, type Difficulty } from "./difficulty";
import { chartVersionFingerprint, midiFingerprint } from "./chartCache";
import type { ParsedMidi } from "./midiFile";
import type { ChartBeatMap, TaikoChart } from "@/shared/taikoChart";

export const ALL_DIFFICULTIES: Difficulty[] = ["easy", "beginner", "standard", "hard"];

export function buildAllCharts(
  midi: ParsedMidi,
  title: string,
  displayBpm = midi.bpm,
  beatMap?: ChartBeatMap | null,
): { difficulty: Difficulty; chart: TaikoChart }[] {
  return ALL_DIFFICULTIES.map((difficulty) => {
    const chart = buildPlayChart(midi, { title, beatMap: beatMap ?? undefined }, difficulty);
    // 有 Metro 轨时展示 BPM 就用它算出来的平均值，否则沿用后台测速结果
    return {
      difficulty,
      chart: beatMap ? chart : { ...chart, bpm: Math.round(displayBpm * 10) / 10 },
    };
  });
}


export { chartVersionFingerprint, midiFingerprint, DIFFICULTIES };
