import { useEffect, useState } from "react";
import { quality } from "./perf";
import { debugLog } from "./debugLog";
import { latencyMeter } from "./latencyMeter";

/**
 * 游玩演奏区左上角帧数徽章。
 * 数据来自 perf.ts 里演奏渲染循环的真实帧采样（非独立 rAF），
 * 每 0.5s 读一次；半透明小字、指针穿透，不挡鼓盘与音符。
 *
 * 调试面板开启时，额外显示输入抖动量表（输入延迟 / 长帧），用于区分
 * 「宿主事件偏晚」与「网页主线程卡顿」。
 */
export function FpsBadge() {
  const [fps, setFps] = useState(0);
  const [jitter, setJitter] = useState<{
    on: boolean;
    input: number;
    inputMax: number;
    longFrames: number;
    lastLong: number;
  }>({ on: false, input: 0, inputMax: 0, longFrames: 0, lastLong: 0 });

  useEffect(() => {
    const id = window.setInterval(() => {
      setFps(quality.fps);
      setJitter({
        on: debugLog.on,
        input: latencyMeter.inputMs,
        inputMax: latencyMeter.inputMaxMs,
        longFrames: latencyMeter.longFrameCount,
        lastLong: latencyMeter.lastLongFrame,
      });
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="pointer-events-none absolute z-40 rounded bg-[var(--taiko-paper)]/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--taiko-ink)]/70"
      style={{ top: "var(--safe-top)", left: "var(--safe-left)" }}
    >
      <div>{fps} FPS</div>
      {jitter.on ? (
        <>
          <div className="mt-0.5">
            IN {jitter.input}/{jitter.inputMax}ms
          </div>
          <div className="mt-0.5">
            LF {jitter.longFrames} ({jitter.lastLong}ms)
          </div>
        </>
      ) : null}
    </div>
  );
}
