/**
 * Metro（节拍器）轨解析：把工程导出的 click 轨变成绝对物理节拍时间轴。
 *
 * 这是整个计时体系的唯一基准：
 * - 每个脉冲的起振时刻就是那一拍的真实毫秒位置，天然支持真人演奏的动态变速；
 * - 重拍（音色不同、能量更强）给出小节线，于是小节 / 正拍 / 反拍全部有了物理锚点；
 * - 原始 MIDI 从此只用于设计鼓谱节奏型，不再参与任何计时。
 */
import type { ChartBeatMap } from "@/shared/taikoChart";

export interface MetroAnalysis {
  /** 每一拍的真实毫秒时刻（升序） */
  beats: number[];
  /** 每拍脉冲强度（0~1），用于判定重拍 */
  strengths: number[];
  /** 小节拍数 */
  beatsPerBar: number;
  /** 首个重拍在 beats 里的下标（对 beatsPerBar 取模后的相位） */
  barPhase: number;
  /** 中位 BPM，仅作展示与元数据 */
  bpm: number;
  /** 变速幅度：最快与最慢单拍 BPM 之差 */
  bpmSpread: number;
}

/** 允许的单拍区间（毫秒）：50–260 BPM */
const MIN_BEAT_MS = 60000 / 260;
const MAX_BEAT_MS = 60000 / 50;

/** 包络帧长（毫秒） */
const FRAME_MS = 2;

/** 单声道包络（每帧取绝对值峰值，click 轨是瞬态，峰值比 RMS 更准） */
function envelopeOf(buffer: AudioBuffer): { env: Float32Array; frameMs: number } {
  const sr = buffer.sampleRate;
  const hop = Math.max(1, Math.round((sr * FRAME_MS) / 1000));
  const frames = Math.floor(buffer.length / hop);
  const env = new Float32Array(frames);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    const end = start + hop;
    let peak = 0;
    for (const data of channels) {
      for (let i = start; i < end; i++) {
        const v = Math.abs(data[i]!);
        if (v > peak) peak = v;
      }
    }
    env[f] = peak;
  }
  return { env, frameMs: (hop / sr) * 1000 };
}

/** 脉冲起振点：局部峰值 + 相对门限 + 最小间隔 */
function detectPulses(env: Float32Array, frameMs: number): { timeMs: number; strength: number }[] {
  let globalPeak = 0;
  for (const v of env) if (v > globalPeak) globalPeak = v;
  if (globalPeak <= 1e-4) return [];
  const gate = globalPeak * 0.18;
  const minGapFrames = Math.max(1, Math.round(MIN_BEAT_MS / frameMs));

  const out: { timeMs: number; strength: number }[] = [];
  let lastIndex = -minGapFrames;
  for (let i = 1; i < env.length - 1; i++) {
    const v = env[i]!;
    if (v < gate) continue;
    if (v < env[i - 1]! || v < env[i + 1]!) continue;
    if (i - lastIndex < minGapFrames) {
      // 同一次击打的余振：保留更强的那个
      const prev = out[out.length - 1];
      if (prev && v > prev.strength) {
        prev.timeMs = i * frameMs;
        prev.strength = v;
        lastIndex = i;
      }
      continue;
    }
    // 起振点回溯到该峰值前最后一个安静帧，避免把包络爬坡算进延迟
    let onset = i;
    while (onset > 0 && env[onset - 1]! > gate * 0.35 && i - onset < minGapFrames / 2) onset--;
    out.push({ timeMs: onset * frameMs, strength: v / globalPeak });
    lastIndex = i;
  }
  return out;
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * 补漏与去重：click 轨理论上每拍一个脉冲，
 * 间隔明显是中位值整数倍时补回缺失拍，明显小于中位值时视为重影丢弃。
 */
function regularize(
  pulses: { timeMs: number; strength: number }[],
): { timeMs: number; strength: number }[] {
  if (pulses.length < 4) return pulses;
  const gaps = [];
  for (let i = 1; i < pulses.length; i++) gaps.push(pulses[i]!.timeMs - pulses[i - 1]!.timeMs);
  const base = median(gaps);
  if (!(base > 0)) return pulses;

  const out: { timeMs: number; strength: number }[] = [pulses[0]!];
  for (let i = 1; i < pulses.length; i++) {
    const prev = out[out.length - 1]!;
    const cur = pulses[i]!;
    const gap = cur.timeMs - prev.timeMs;
    const ratio = gap / base;
    if (ratio < 0.62) continue; // 重影 / 双击
    const missing = Math.round(ratio) - 1;
    if (missing > 0 && missing <= 8 && Math.abs(ratio - Math.round(ratio)) < 0.22) {
      for (let k = 1; k <= missing; k++) {
        out.push({ timeMs: prev.timeMs + (gap * k) / (missing + 1), strength: prev.strength * 0.8 });
      }
    }
    out.push(cur);
  }
  return out;
}

/** 重拍相位与小节拍数：重音周期性最强的那组胜出 */
function findBar(strengths: number[]): { beatsPerBar: number; barPhase: number } {
  const candidates = [4, 3, 6, 2, 5, 8];
  let best = { beatsPerBar: 4, barPhase: 0, score: -Infinity };
  for (const bar of candidates) {
    if (strengths.length < bar * 3) continue;
    for (let phase = 0; phase < bar; phase++) {
      let onSum = 0;
      let onCount = 0;
      let offSum = 0;
      let offCount = 0;
      for (let i = 0; i < strengths.length; i++) {
        if (i % bar === phase) {
          onSum += strengths[i]!;
          onCount++;
        } else {
          offSum += strengths[i]!;
          offCount++;
        }
      }
      if (!onCount || !offCount) continue;
      // 偏好 4/4：同等重音对比度下小节越常见越优
      const contrast = onSum / onCount - offSum / offCount;
      const score = contrast * (bar === 4 ? 1.15 : bar === 3 ? 1.05 : 1);
      if (score > best.score) best = { beatsPerBar: bar, barPhase: phase, score };
    }
  }
  return { beatsPerBar: best.beatsPerBar, barPhase: best.barPhase };
}

/** 解码后的 Metro 轨 → 绝对节拍时间轴；脉冲太少时返回 null（调用方回退旧逻辑） */
export function analyzeMetroBuffer(buffer: AudioBuffer): MetroAnalysis | null {
  const { env, frameMs } = envelopeOf(buffer);
  const pulses = regularize(detectPulses(env, frameMs));
  if (pulses.length < 8) return null;

  const beats = pulses.map((p) => p.timeMs);
  const strengths = pulses.map((p) => p.strength);
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i++) gaps.push(beats[i]! - beats[i - 1]!);
  const mid = median(gaps);
  if (!(mid >= MIN_BEAT_MS && mid <= MAX_BEAT_MS)) return null;

  const usable = gaps.filter((g) => g >= MIN_BEAT_MS && g <= MAX_BEAT_MS);
  const fastest = Math.min(...usable);
  const slowest = Math.max(...usable);
  const { beatsPerBar, barPhase } = findBar(strengths);

  return {
    beats,
    strengths,
    beatsPerBar,
    barPhase,
    bpm: Math.round((60000 / mid) * 10) / 10,
    bpmSpread: Math.round((60000 / fastest - 60000 / slowest) * 10) / 10,
  };
}

/** 解析结果 → 存进谱面的紧凑时间轴（毫秒取整，省下 JSON 体积） */
export function toChartBeatMap(analysis: MetroAnalysis): ChartBeatMap {
  return {
    beats: analysis.beats.map((t) => Math.round(t)),
    beatsPerBar: analysis.beatsPerBar,
    barPhase: analysis.barPhase,
  };
}

/** 直接从文件解析（后台导入用） */
export async function analyzeMetroFile(
  file: File,
  ctx: BaseAudioContext,
): Promise<MetroAnalysis | null> {
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  return analyzeMetroBuffer(buffer);
}
