/**
 * 鼓节奏自动分析：三频带 onset 检测 → 量化到节拍网格 → 按小节聚类节奏型，
 * 产出可勾选的 MIDI 段落卡片；勾选的段落按其实际出现的小节铺进谱面。
 *
 * 启发式：低频→底鼓、中频→军鼓、高频→踩镲。混音复杂时会误判，
 * 界面需标注「自动分析仅供参考」，最终谱面由用户勾选段落确认。
 */
import { getDrumLane } from "@/shared/drumLaneMap";
import type { TaikoChart, TaikoNote } from "@/shared/taikoChart";
import type { LayoutMode, PartId } from "./laneLayouts";

export type DrumBand = "kick" | "snare" | "hihat";

/** 频带 → 写入谱面的 MIDI 音符 */
export const BAND_NOTE: Record<DrumBand, number> = { kick: 36, snare: 38, hihat: 42 };
export const BAND_LABEL: Record<DrumBand, string> = {
  kick: "底鼓",
  snare: "军鼓",
  hihat: "踩镲",
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

export interface DrumAnalysis {
  segments: DrumSegment[];
  /** 每小节鼓声活跃度，已归一化到 0–1 */
  barActivity: number[];
  /** 稳定鼓声开始/结束小节（均包含）；无有效鼓段时为 null */
  activeRange: [number, number] | null;
}

const ANALYSIS_SR = 8000;
const HOP = 256; // 32ms @ 8kHz
const QUANT = 0.25; // 量化到 16 分音符

const yieldMain = () => new Promise<void>((r) => setTimeout(r, 0));

/** 用 OfflineAudioContext 分频段渲染（8kHz 降采样，快） */
async function renderBand(buffer: AudioBuffer, band: DrumBand): Promise<Float32Array> {
  const sr = ANALYSIS_SR;
  const frames = Math.max(1, Math.ceil(buffer.duration * sr));
  const ctx = new OfflineAudioContext(1, frames, sr);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  let node: AudioNode = src;
  const addFilter = (type: BiquadFilterType, freq: number) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    node.connect(f);
    node = f;
  };
  if (band === "kick") addFilter("lowpass", 150);
  else if (band === "snare") {
    addFilter("highpass", 1200);
    addFilter("lowpass", 5000);
  } else addFilter("highpass", 6000);
  node.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

/** 能量包络 onset 检测（正向差分 + 自适应阈值 + 最小间隔峰值拾取） */
function detectOnsets(pcm: Float32Array, band: DrumBand): number[] {
  const hopMs = (HOP / ANALYSIS_SR) * 1000;
  const frameCount = Math.floor(pcm.length / HOP);
  const energy = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let s = 0;
    const base = i * HOP;
    for (let j = 0; j < HOP; j += 4) s += Math.abs(pcm[base + j] ?? 0);
    energy[i] = s;
  }
  const nov = new Float32Array(frameCount);
  for (let i = 1; i < frameCount; i++) nov[i] = Math.max(0, energy[i]! - energy[i - 1]!);

  const win = Math.round(500 / hopMs); // 0.5s 邻域均值
  const k = band === "kick" ? 1.7 : band === "snare" ? 1.6 : 2.0;
  const minGap = Math.max(1, Math.round((band === "hihat" ? 70 : 120) / hopMs));

  const onsets: number[] = [];
  const peakVals: number[] = [];
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
    if (nov[i]! < mean * k + 1e-4) continue;
    const tMs = i * hopMs;
    const last = onsets.length - 1;
    if (last >= 0 && tMs - onsets[last]! < minGap * hopMs) {
      // 间隔内保留更强者
      if (nov[i]! > peakVals[last]!) {
        onsets[last] = tMs;
        peakVals[last] = nov[i]!;
      }
      continue;
    }
    onsets.push(tMs);
    peakVals.push(nov[i]!);
  }
  return onsets;
}

// ---- 相似度聚类：真实演奏每小节有微小差异，不能用「完全相同」签名 ----

/** 位图步进：每拍 4 步（16 分网格） */
const STEPS_PER_BEAT = 4;
/** 三段频带位图加权 Jaccard ≥ 此值归并为同一段落 */
const CLUSTER_SIM = 0.7;
/** 频带权重：底鼓/军鼓是节奏骨架，踩镲装饰性强、容忍差异 */
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
 * 分析整曲，返回节奏型段落卡片（按出现次数排序，最多 12 张）。
 * 分段/量化按传入的 bpm / offsetMs / timeSignature 网格进行；
 * 聚类按 16 分位图相似度归并，段落音符取簇成员的多数表决代表型。
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

  // onset → 每小节步进位图
  const perBar = new Map<number, BarPattern>();
  for (const band of bands) {
    const pcm = await renderBand(buffer, band);
    const onsets = detectOnsets(pcm, band);
    await yieldMain();
    for (const tMs of onsets) {
      const beat = (tMs - offsetMs) / beatMs;
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
      p.bm[band][step] = 1;
    }
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

  // 代表位图 → 段落音符；按出现次数排序，单次段落自然排后
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

  const barCount = Math.max(1, Math.ceil((buffer.duration * 1000 - offsetMs) / (beatMs * beatsPerBar)));
  const rawActivity = Array.from({ length: barCount }, (_, bar) => {
    const pattern = perBar.get(bar);
    if (!pattern) return 0;
    let score = 0;
    for (const band of bands) {
      const weight = band === "hihat" ? 0.55 : 1;
      for (const hit of pattern.bm[band]) score += hit ? weight : 0;
    }
    return score;
  });
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
    activeRange:
      activeStart >= 0 && activeEnd >= activeStart ? [activeStart, activeEnd] : fallbackRange,
  };
}

const PART_NOTE: Record<PartId, number> = {
  pedalHat: 44,
  kick: 36,
  hihat: 42,
  crash: 49,
  snare: 38,
  highTom: 48,
  midTom: 47,
  floorTom: 43,
  ride: 51,
};

function stableUnit(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/** 由单一主体生成整段谱面；同参数输出始终一致。 */
export function buildChart(opts: {
  segments: DrumSegment[];
  primarySegmentId: string | null;
  barActivity: readonly number[];
  activeRange: [number, number] | null;
  layout: LayoutMode;
  bpm: number;
  offsetMs: number;
  timeSignature: [number, number];
  durationMs: number;
  title: string;
}): TaikoChart {
  const beatMs = 60000 / opts.bpm;
  const out: TaikoNote[] = [];
  const primary = opts.segments.find((s) => s.id === opts.primarySegmentId);
  const range = opts.activeRange;

  const add = (bar: number, beat: number, part: PartId) => {
    if (!primary || beat < 0 || beat >= primary.beatsPerBar) return;
    const timeMs = opts.offsetMs + (bar * primary.beatsPerBar + beat) * beatMs;
    if (timeMs < 0 || timeMs > opts.durationMs) return;
    const midi = PART_NOTE[part];
    const lane = getDrumLane(midi);
    if (lane) out.push({ timeMs, lane, note: midi });
  };

  if (primary && range) {
    for (let bar = range[0]; bar <= range[1]; bar++) {
      const activity = opts.barActivity[bar] ?? 0;
      const prevActivity = opts.barActivity[bar - 1] ?? activity;
      const phraseStart = bar === range[0] || bar % 8 === 0;
      const phraseEnd = bar === range[1] || (bar + 1) % 4 === 0;
      const rising = activity - prevActivity > 0.18;
      const seed = `${opts.title}|${opts.primarySegmentId}|${opts.layout}|${bar}`;

      // 主体骨架贯穿有效区间；极安静小节只保留底鼓/军鼓，形成自然呼吸。
      for (const note of primary.notes) {
        if (activity < 0.08 && note.band === "hihat") continue;
        const part: PartId = note.band === "kick" ? "kick" : note.band === "snare" ? "snare" : "hihat";
        add(bar, note.beat, part);
      }

      const strong = activity >= 0.55;
      const veryStrong = activity >= 0.75;
      if (opts.layout === "five") {
        if (phraseEnd && strong && stableUnit(`${seed}|floor`) < 0.62) {
          add(bar, primary.beatsPerBar - 0.5, "floorTom");
        }
        if (veryStrong && stableUnit(`${seed}|pedal`) < 0.28) {
          add(bar, Math.max(0, primary.beatsPerBar - 1), "pedalHat");
        }
      } else {
        if (phraseStart && (strong || rising)) add(bar, 0, "crash");
        if (phraseEnd && strong) {
          add(bar, primary.beatsPerBar - 0.75, "highTom");
          if (stableUnit(`${seed}|mid`) < 0.72) add(bar, primary.beatsPerBar - 0.5, "midTom");
          if (veryStrong) add(bar, primary.beatsPerBar - 0.25, "floorTom");
        }
        if (strong && stableUnit(`${seed}|tom`) < 0.2) {
          add(bar, Math.max(0, primary.beatsPerBar / 2), "highTom");
        }
        if (veryStrong && stableUnit(`${seed}|ride`) < 0.14) add(bar, 0, "ride");
        if (veryStrong && stableUnit(`${seed}|pedal`) < 0.1) {
          add(bar, Math.max(0, primary.beatsPerBar - 1), "pedalHat");
        }
      }
    }
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  const dedup: TaikoNote[] = [];
  for (const n of out) {
    const last = dedup[dedup.length - 1];
    if (last && last.note === n.note && Math.abs(last.timeMs - n.timeMs) < 40) continue;
    dedup.push(n);
  }
  return {
    title: opts.title,
    bpm: opts.bpm,
    timeSignature: opts.timeSignature,
    durationMs: opts.durationMs,
    notes: dedup,
  };
}
