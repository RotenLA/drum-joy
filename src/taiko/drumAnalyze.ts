/**
 * 鼓声自动分析：统一 onset 检测 → 逐击点频谱特征分类（底鼓 / 军鼓 / 镲）
 * → 量化到节拍网格 → 按小节聚类节奏型，产出可单选为主体的段落卡片，
 * 并记录逐小节活跃度与三类鼓件占比，供全曲编谱使用。
 *
 * 为什么不再用「三条独立滤波链各自检测」：镲片主要能量落在 2–8 kHz，
 * 与军鼓的中高噪声完全重叠，独立检测会把每一次镲都写成军鼓。
 * 现在只做一次 onset 检测，再用低频 / 鼓腔 / 中高噪声 / 极高频 + 衰减时长
 * 判断这一击是什么鼓件，阈值取整曲分位数自适应。
 */
import type { LayoutMode } from "./laneLayouts";

export type DrumBand = "kick" | "snare" | "hihat";

/** 频带 → 写入谱面的 MIDI 音符 */
export const BAND_NOTE: Record<DrumBand, number> = { kick: 36, snare: 38, hihat: 42 };
export const BAND_LABEL: Record<DrumBand, string> = {
  kick: "底鼓",
  snare: "军鼓",
  hihat: "镲",
};

/** 段落内一个音符：beat 为相对小节首拍的拍位置（已量化到 1/4 拍） */
export interface SegmentNote {
  beat: number;
  band: DrumBand;
}

export interface DrumSegment {
  id: string;
  /** 一小节内的节奏型 */
  notes: SegmentNote[];
  /** 该节奏型出现的小节序号（0 起） */
  bars: number[];
  /** 检测时的每小节拍数（分段网格按它计算，改拍号后点「重新分析」重排） */
  beatsPerBar: number;
}

/** 每小节三类鼓件的击数（未归一化） */
export interface BarBands {
  kick: number;
  snare: number;
  hihat: number;
}

export interface DrumAnalysis {
  segments: DrumSegment[];
  /** 每小节鼓声活跃度，已归一化到 0–1 */
  barActivity: number[];
  /** 每小节三类鼓件击数（弱鼓段降级时判断该留镲还是留底鼓） */
  barBands: BarBands[];
  /** 稳定鼓声开始/结束小节（均包含）；无有效鼓段时为 null */
  activeRange: [number, number] | null;
}

const ANALYSIS_SR = 22050;
const HOP = 512; // ≈23ms @22.05kHz
const HOP_MS = (HOP / ANALYSIS_SR) * 1000;
const QUANT = 0.25; // 量化到 16 分音符

const yieldMain = () => new Promise<void>((r) => setTimeout(r, 0));

type FeatBand = "low" | "body" | "mid" | "high";

const FEAT_FILTERS: Record<FeatBand, readonly [BiquadFilterType, number][]> = {
  low: [["lowpass", 110]],
  body: [["highpass", 140], ["lowpass", 320]],
  mid: [["highpass", 2000], ["lowpass", 6000]],
  high: [["highpass", 8000]],
};

/** 单条滤波链渲染（22.05kHz 降采样，足以覆盖 8kHz 以上的镲片能量） */
async function renderFiltered(
  buffer: AudioBuffer,
  chain: readonly [BiquadFilterType, number][],
): Promise<Float32Array> {
  const frames = Math.max(1, Math.ceil(buffer.duration * ANALYSIS_SR));
  const ctx = new OfflineAudioContext(1, frames, ANALYSIS_SR);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  let node: AudioNode = src;
  for (const [type, freq] of chain) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    node.connect(f);
    node = f;
  }
  node.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

/** 平均绝对值包络（每 HOP 一帧） */
function envelope(pcm: Float32Array, frameCount: number): Float32Array {
  const env = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let s = 0;
    let c = 0;
    const base = i * HOP;
    for (let j = 0; j < HOP; j += 2) {
      s += Math.abs(pcm[base + j] ?? 0);
      c++;
    }
    env[i] = c > 0 ? s / c : 0;
  }
  return env;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx] ?? 0;
}

/** 按分位数归一化（抗个别极端峰值） */
function normalize(env: Float32Array): Float32Array {
  const ref = quantile(Array.from(env), 0.98) || 1e-6;
  const out = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) out[i] = Math.min(2.5, env[i]! / ref);
  return out;
}

interface Hit {
  frame: number;
  timeMs: number;
  bands: DrumBand[];
}

/** 统一 onset 检测 + 逐击点分类 */
async function detectHits(buffer: AudioBuffer): Promise<Hit[]> {
  const frameCount = Math.max(
    1,
    Math.floor((buffer.duration * ANALYSIS_SR) / HOP),
  );
  const env: Record<FeatBand, Float32Array> = {
    low: new Float32Array(frameCount),
    body: new Float32Array(frameCount),
    mid: new Float32Array(frameCount),
    high: new Float32Array(frameCount),
  };
  for (const band of ["low", "body", "mid", "high"] as FeatBand[]) {
    const pcm = await renderFiltered(buffer, FEAT_FILTERS[band]);
    env[band] = normalize(envelope(pcm, frameCount));
    await yieldMain();
  }

  // ---- 统一 novelty（正向差分加权和）----
  const W: Record<FeatBand, number> = { low: 1, body: 0.6, mid: 1, high: 0.9 };
  const nov = new Float32Array(frameCount);
  for (let i = 1; i < frameCount; i++) {
    let v = 0;
    for (const band of ["low", "body", "mid", "high"] as FeatBand[]) {
      v += W[band] * Math.max(0, env[band][i]! - env[band][i - 1]!);
    }
    nov[i] = v;
  }

  const win = Math.round(500 / HOP_MS);
  const minGapFrames = Math.max(1, Math.round(55 / HOP_MS));
  const peaks: number[] = [];
  for (let i = 1; i < frameCount - 1; i++) {
    if (nov[i]! <= 0) continue;
    if (nov[i]! < nov[i - 1]! || nov[i]! < nov[i + 1]!) continue;
    let mean = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - win); j < i; j++) {
      mean += nov[j]!;
      cnt++;
    }
    mean = cnt > 0 ? mean / cnt : 0;
    if (nov[i]! < mean * 1.5 + 2e-3) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && i - last < minGapFrames) {
      if (nov[i]! > nov[last]!) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }

  // ---- 逐击点特征 ----
  const peakOf = (band: FeatBand, i: number) => {
    let m = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(frameCount - 1, i + 4); j++) {
      m = Math.max(m, env[band][j]!);
    }
    return m;
  };
  const decayMs = (i: number) => {
    const total = (j: number) =>
      (env.low[j] ?? 0) * 0.5 + (env.body[j] ?? 0) + (env.mid[j] ?? 0) + (env.high[j] ?? 0);
    let peakFrame = i;
    let peakVal = total(i);
    for (let j = i; j <= Math.min(frameCount - 1, i + 4); j++) {
      const v = total(j);
      if (v > peakVal) {
        peakVal = v;
        peakFrame = j;
      }
    }
    if (peakVal <= 0) return 0;
    for (let j = peakFrame + 1; j <= Math.min(frameCount - 1, peakFrame + 20); j++) {
      if (total(j) < peakVal * 0.25) return (j - peakFrame) * HOP_MS;
    }
    return 20 * HOP_MS;
  };

  const feats = peaks.map((i) => ({
    frame: i,
    low: peakOf("low", i),
    body: peakOf("body", i),
    mid: peakOf("mid", i),
    high: peakOf("high", i),
    decay: decayMs(i),
  }));

  // ---- 自适应阈值（整曲分位数）----
  const thr = (key: "low" | "body" | "mid" | "high", q: number, floor: number) =>
    Math.max(floor, quantile(feats.map((f) => f[key]), q) * 0.5);
  const thrLow = thr("low", 0.6, 0.06);
  const thrBody = thr("body", 0.55, 0.05);
  const thrMid = thr("mid", 0.55, 0.05);
  const thrHigh = thr("high", 0.5, 0.04);

  // 手击（军鼓 / 镲）用「亮度」相对判定：镲的 8k+ 能量相对 2–6k + 军鼓体感更突出。
  // 注意：不能用衰减时间，密集混音里整体包络几乎不会掉到峰值 25% 以下。
  const brightness = (f: (typeof feats)[number]) => f.high / (f.mid + f.body * 0.6 + 1e-6);
  const handFeats = feats.filter((f) => f.high >= thrHigh || f.mid >= thrMid);
  const brightMed = quantile(handFeats.map(brightness), 0.5) || 1;
  const bodyMed = quantile(handFeats.map((f) => f.body), 0.5) || 1;

  const hits: Hit[] = [];
  for (const f of feats) {
    const bands: DrumBand[] = [];
    // 底鼓：低频主导，且不是被镲片的宽带能量带起来的
    if (f.low >= thrLow && f.low >= f.high * 0.7) bands.push("kick");
    const handHit = f.high >= thrHigh || f.mid >= thrMid;
    if (handHit) {
      const snareLike =
        brightness(f) <= brightMed * 0.95 && f.body >= Math.max(thrBody * 0.8, bodyMed * 0.55);
      bands.push(snareLike ? "snare" : "hihat");
    }
    if (bands.length === 0) continue;
    hits.push({ frame: f.frame, timeMs: f.frame * HOP_MS, bands });
  }
  return hits;
}

// ---- 相似度聚类：真实演奏每小节有微小差异，不能用「完全相同」签名 ----

/** 位图步进：每拍 4 步（16 分网格） */
const STEPS_PER_BEAT = 4;
/** 三段频带位图加权 Jaccard ≥ 此值归并为同一段落 */
const CLUSTER_SIM = 0.7;
/** 频带权重：底鼓/军鼓是节奏骨架，镲装饰性强、容忍差异 */
const BAND_W: Record<DrumBand, number> = { kick: 1, snare: 1, hihat: 0.6 };

type BandBitmap = Record<DrumBand, Uint8Array>;

interface BarPattern {
  bar: number;
  bm: BandBitmap;
}

function emptyBitmap(steps: number): BandBitmap {
  return {
    kick: new Uint8Array(steps),
    snare: new Uint8Array(steps),
    hihat: new Uint8Array(steps),
  };
}

/** 两小节型的加权 Jaccard 相似度（两空频带视为一致） */
function bitmapSim(a: BandBitmap, b: BandBitmap, bands: readonly DrumBand[]): number {
  let num = 0;
  let den = 0;
  for (const band of bands) {
    const w = BAND_W[band];
    const x = a[band];
    const y = b[band];
    let inter = 0;
    let union = 0;
    for (let i = 0; i < x.length; i++) {
      if (x[i] && y[i]) inter++;
      if (x[i] || y[i]) union++;
    }
    num += w * (union === 0 ? 1 : inter / union);
    den += w;
  }
  return den > 0 ? num / den : 0;
}

/** 簇代表位图：成员多数表决（≥ 半数成员在该步有击则保留） */
function majorityBitmap(
  members: readonly BarPattern[],
  steps: number,
  bands: readonly DrumBand[],
): BandBitmap {
  const rep = emptyBitmap(steps);
  for (const band of bands) {
    for (let s = 0; s < steps; s++) {
      let c = 0;
      for (const m of members) if (m.bm[band][s]) c++;
      if (c * 2 >= members.length) rep[band][s] = 1;
    }
  }
  return rep;
}

/**
 * 分析整曲，返回节奏型段落卡片（按出现次数排序，最多 12 张）
 * 以及逐小节活跃度 / 三类鼓件占比 / 有效鼓声区间。
 */
export async function analyzeDrums(
  buffer: AudioBuffer,
  bpm: number,
  offsetMs: number,
  timeSignature: [number, number],
): Promise<DrumAnalysis> {
  const beatMs = 60000 / bpm;
  const beatsPerBar = timeSignature[0] * (4 / timeSignature[1]);
  const bands: DrumBand[] = ["kick", "snare", "hihat"];
  const steps = Math.max(STEPS_PER_BEAT, Math.round(beatsPerBar * STEPS_PER_BEAT));

  const hits = await detectHits(buffer);

  // 击点 → 每小节步进位图
  const perBar = new Map<number, BarPattern>();
  for (const hit of hits) {
    const beat = (hit.timeMs - offsetMs) / beatMs;
    if (beat < 0) continue;
    const q = Math.round(beat / QUANT) * QUANT;
    const bar = Math.floor(q / beatsPerBar);
    const step = Math.round((q - bar * beatsPerBar) * STEPS_PER_BEAT);
    if (step < 0 || step >= steps) continue;
    let p = perBar.get(bar);
    if (!p) {
      p = { bar, bm: emptyBitmap(steps) };
      perBar.set(bar, p);
    }
    for (const band of hit.bands) p.bm[band][step] = 1;
  }

  // 贪心相似度聚类（按小节顺序；与现有簇代表比较，归并最相似者）
  interface Cluster {
    id: string;
    members: BarPattern[];
    rep: BandBitmap;
  }
  const clusters: Cluster[] = [];
  for (const p of [...perBar.values()].sort((a, b) => a.bar - b.bar)) {
    let best: Cluster | null = null;
    let bestSim = 0;
    for (const c of clusters) {
      const s = bitmapSim(p.bm, c.rep, bands);
      if (s > bestSim) {
        bestSim = s;
        best = c;
      }
    }
    if (best && bestSim >= CLUSTER_SIM) {
      best.members.push(p);
      best.rep = majorityBitmap(best.members, steps, bands);
    } else {
      clusters.push({
        id: `seg-${clusters.length}`,
        members: [p],
        rep: majorityBitmap([p], steps, bands),
      });
    }
  }

  const segments: DrumSegment[] = clusters.map((c) => {
    const notes: SegmentNote[] = [];
    for (const band of bands) {
      const bm = c.rep[band];
      for (let s = 0; s < steps; s++) {
        if (bm[s]) notes.push({ beat: Math.round((s / STEPS_PER_BEAT) * 100) / 100, band });
      }
    }
    notes.sort((a, b) => a.beat - b.beat || a.band.localeCompare(b.band));
    return {
      id: c.id,
      notes,
      bars: c.members.map((m) => m.bar).sort((a, b) => a - b),
      beatsPerBar,
    };
  });

  const rankedSegments = segments
    .filter((s) => s.notes.length > 0)
    .sort((a, b) => b.bars.length - a.bars.length || b.notes.length - a.notes.length)
    .slice(0, 12);

  const barCount = Math.max(
    1,
    Math.ceil((buffer.duration * 1000 - offsetMs) / (beatMs * beatsPerBar)),
  );
  const barBands: BarBands[] = Array.from({ length: barCount }, (_, bar) => {
    const pattern = perBar.get(bar);
    const count = (band: DrumBand) => {
      if (!pattern) return 0;
      let c = 0;
      for (const hit of pattern.bm[band]) if (hit) c++;
      return c;
    };
    return { kick: count("kick"), snare: count("snare"), hihat: count("hihat") };
  });
  const rawActivity = barBands.map((b) => b.kick + b.snare + b.hihat * 0.55);
  const maxActivity = Math.max(0, ...rawActivity);
  const barActivity = rawActivity.map((v) => (maxActivity > 0 ? v / maxActivity : 0));

  const activeThreshold = 0.12;
  const stableAt = (bar: number) => {
    let active = 0;
    for (let i = bar; i < Math.min(barCount, bar + 3); i++) {
      if ((barActivity[i] ?? 0) >= activeThreshold) active++;
    }
    return active >= 2;
  };
  let activeStart = -1;
  for (let bar = 0; bar < barCount; bar++) {
    if (stableAt(bar)) {
      activeStart = bar;
      break;
    }
  }
  let activeEnd = -1;
  for (let bar = barCount - 1; bar >= 0; bar--) {
    let active = 0;
    for (let i = Math.max(0, bar - 2); i <= bar; i++) {
      if ((barActivity[i] ?? 0) >= activeThreshold) active++;
    }
    if (active >= 2) {
      activeEnd = bar;
      break;
    }
  }
  const detectedBars = [...perBar.keys()].sort((a, b) => a - b);
  const fallbackRange: [number, number] | null = detectedBars.length
    ? [detectedBars[0] ?? 0, detectedBars[detectedBars.length - 1] ?? 0]
    : null;

  return {
    segments: rankedSegments,
    barActivity,
    barBands,
    activeRange:
      activeStart >= 0 && activeEnd >= activeStart ? [activeStart, activeEnd] : fallbackRange,
  };
}

/** 分区可用鼓件（编谱与简化共用） */
export const LAYOUT_PARTS: Record<LayoutMode, readonly string[]> = {
  five: ["kick", "hihat", "snare", "floorTom", "pedalHat"],
  nine: [
    "kick",
    "hihat",
    "snare",
    "crash",
    "highTom",
    "midTom",
    "floorTom",
    "ride",
    "pedalHat",
  ],
};
