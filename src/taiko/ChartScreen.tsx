/**
 * 谱面设置屏：只放全局设置（画质、偏移校准）。
 * 选歌与历史演奏已移入游玩屏的选歌层；
 * 难度、下落速度、手机音色、鼓组、下落模式都在展开的歌曲卡片里设置。
 */
import { GlobalSettings } from "./GlobalSettings";

export function ChartScreen() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <GlobalSettings />
    </div>
  );
}
