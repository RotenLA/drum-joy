/**
 * 谱面设置屏：只放全局设置（画质、偏移校准、鼓音色、速度、难度）。
 * 选歌与历史演奏已移入游玩屏的选歌层。
 */
import { GlobalSettings } from "./GlobalSettings";
import type { FallMode } from "./fallMode";

export function ChartScreen({
  speed,
  onSpeedChange,
  fallMode = "stage",
  onFallModeChange = () => {},
}: {
  speed: number;
  onSpeedChange: (s: number) => void;
  fallMode?: FallMode;
  onFallModeChange?: (mode: FallMode) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <GlobalSettings
        speed={speed}
        onSpeedChange={onSpeedChange}
        fallMode={fallMode}
        onFallModeChange={onFallModeChange}
      />
    </div>
  );
}
