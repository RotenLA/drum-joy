import { useEffect, useState } from "react";

/**
 * 全局左上角帧数徽章：rAF 计数，每秒刷新一次。
 * 指针事件穿透，不挡任何操作；随 taiko-root 安全区内缩。
 */
export function FpsBadge() {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frames = 0;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frames++;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="pointer-events-none absolute z-50 rounded bg-[var(--taiko-paper)]/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--taiko-ink)]/70"
      style={{ top: "var(--safe-top)", left: "var(--safe-left)" }}
    >
      {fps} FPS
    </div>
  );
}
