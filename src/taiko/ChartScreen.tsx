/**
 * 谱面设置屏：只放全局设置（画质、偏移校准、鼓音色、速度、难度）。
 * 选歌与历史演奏已移入游玩屏的选歌层。
 */
import { GlobalSettings } from "./GlobalSettings";

export function ChartScreen({
  speed,
  onSpeedChange,
}: {
  speed: number;
  onSpeedChange: (s: number) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <GlobalSettings speed={speed} onSpeedChange={onSpeedChange} />
    </div>
  );
}
