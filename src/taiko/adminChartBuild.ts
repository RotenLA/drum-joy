/**
 * 后台上传时预生成四档谱面：与游玩端完全同一套生成代码，
 * 所以库里存的谱面就是玩家实际打到的谱面。
 */
import { buildPlayChart, DIFFICULTIES, type Difficulty } from "./difficulty";
import { midiFingerprint } from "./chartCache";
import type { ParsedMidi } from "./midiFile";
import type { TaikoChart } from "@/shared/taikoChart";

export const ALL_DIFFICULTIES: Difficulty[] = ["easy", "beginner", "standard", "hard"];

export function buildAllCharts(
  midi: ParsedMidi,
  title: string,
): { difficulty: Difficulty; chart: TaikoChart }[] {
  return ALL_DIFFICULTIES.map((difficulty) => ({
    difficulty,
    chart: buildPlayChart(midi, { title }, difficulty),
  }));
}

export { midiFingerprint, DIFFICULTIES };
