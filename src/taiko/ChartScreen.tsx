/**
 * 谱面设置屏：放全局设置。
 * 选歌与历史演奏已移入游玩屏的选歌层；
 * 当前正式界面由选歌层打开设置弹窗；此屏仅保留兼容入口。
 */
import { GlobalSettings } from "./GlobalSettings";

export function ChartScreen({
  speed,
  onSpeedChange,
}: {
  speed: number;
  onSpeedChange: (speed: number) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <GlobalSettings
        speed={speed}
        onSpeedChange={onSpeedChange}
      />
    </div>
  );
}
