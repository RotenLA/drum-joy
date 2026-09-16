import { useEffect, useState } from "react";
import { quality } from "./perf";

/**
 * 游玩演奏区左上角帧数徽章。
 * 数据来自 perf.ts 里演奏渲染循环的真实帧采样（非独立 rAF），
 * 每 0.5s 读一次；半透明小字、指针穿透，不挡鼓盘与音符。
 */
export function FpsBadge() {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setFps(quality.fps), 500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="pointer-events-none absolute z-40 rounded bg-[var(--taiko-paper)]/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--taiko-ink)]/70"
      style={{ top: "var(--safe-top)", left: "var(--safe-left)" }}
    >
      {fps} FPS
    </div>
  );
}
