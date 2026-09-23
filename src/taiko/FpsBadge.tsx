import { useEffect, useState } from "react";
import { quality } from "./perf";
import { debugLog } from "./debugLog";
import { latencyMeter } from "./latencyMeter";
import { activeVoiceCount, audioJitterMs } from "./drumKit";
import { outputLatencyMs } from "./metronome";

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
    voices: number;
    audJitter: number;
    outLatency: number;
  }>({
    on: false,
    input: 0,
    inputMax: 0,
    longFrames: 0,
    lastLong: 0,
    voices: 0,
    audJitter: 0,
    outLatency: 0,
  });

  useEffect(() => {
    const id = window.setInterval(() => {
      setFps(quality.fps);
      setJitter({
        on: debugLog.on,
        input: latencyMeter.inputMs,
        inputMax: latencyMeter.inputMaxMs,
        longFrames: latencyMeter.longFrameCount,
        lastLong: latencyMeter.lastLongFrame,
        voices: activeVoiceCount(),
        audJitter: audioJitterMs(),
        outLatency: outputLatencyMs(),
      });
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const inNow = jitter.input > 0 ? `${jitter.input}` : "-";
  const inMax = jitter.inputMax > 0 ? `${jitter.inputMax}` : "-";

  return (
    <div
      className="pointer-events-none absolute z-40 rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,12,18,0.72)] px-2 py-1.5 font-mono text-[11px] leading-tight text-[rgba(255,255,255,0.82)] backdrop-blur-[8px]"
      style={{ top: "var(--safe-top)", left: "var(--safe-left)" }}
    >
      <div className="tabular-nums text-[rgba(255,255,255,0.95)]">{fps} FPS</div>
      {jitter.on ? (
        <>
          <div className="mt-1 text-[rgba(255,255,255,0.65)]" title="输入延迟：当前/最近50次最大（0或-表示暂无敲击）">
            IN {inNow}/{inMax}ms
          </div>
          <div className="mt-0.5 text-[rgba(255,255,255,0.65)]" title="长帧：累计次数 / 最近一次耗时（>30ms视为长帧）">
            LF {jitter.longFrames} ({jitter.lastLong}ms)
          </div>
          <div className="mt-0.5 text-[rgba(255,255,255,0.65)]" title="鼓声：当前同时发声数（击打为零排程立即发声）">
            AU {jitter.voices}
          </div>
          <div
            className="mt-0.5 text-[rgba(255,255,255,0.65)]"
            title="发声抖动：音频时钟漂移最大值 / 输出链路延迟"
          >
            AUD {jitter.audJitter}ms / {jitter.outLatency}ms
          </div>
        </>
      ) : null}
    </div>
  );
}
