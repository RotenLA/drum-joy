/**
 * 鼓节奏自动分析：三频带 onset 检测 → 量化到节拍网格 → 按小节聚类节奏型，
 * 产出可勾选的 MIDI 段落卡片；勾选的段落按其实际出现的小节铺进谱面。
 *
 * 启发式：低频→底鼓、中频→军鼓、高频→踩镲。混音复杂时会误判，
 * 界面需标注「自动分析仅供参考」，最终谱面由用户勾选段落确认。
 */
import { getDrumLane } from "@/shared/drumLaneMap";
import type { TaikoChart, TaikoNote } from "@/shared/taikoChart";

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

/**
 * 分析整曲，返回节奏型段落卡片（按出现次数排序，最多 10 张）。
 * 分段/量化按传入的 bpm / offsetMs / timeSignature 网格进行。
 */
export async function analyzeDrums(
  buffer: AudioBuffer,
  bpm: number,
  offsetMs: number,
  timeSignature: [number, number],
): Promise<DrumSegment[]> {
  const beatMs = 60000 / bpm;
  const beatsPerBar = timeSignature[0] * (4 / timeSignature[1]);
  const bands: DrumBand[] = ["kick", "snare", "hihat"];

  const perBar = new Map<number, SegmentNote[]>();
  for (const band of bands) {
    const pcm = await renderBand(buffer, band);
    const onsets = detectOnsets(pcm, band);
    await yieldMain();
    for (const tMs of onsets) {
      const beat = (tMs - offsetMs) / beatMs;
      if (beat < 0) continue;
      const q = Math.round(beat / QUANT) * QUANT;
      const bar = Math.floor(q / beatsPerBar);
      const beatInBar = Math.round((q - bar * beatsPerBar) * 100) / 100;
      const arr = perBar.get(bar) ?? [];
      if (!arr.some((n) => n.beat === beatInBar && n.band === band)) {
        arr.push({ beat: beatInBar, band });
      }
      perBar.set(bar, arr);
    }
  }

  // 聚类：完全相同的小节型归为一类
  const clusters = new Map<string, DrumSegment>();
  let idx = 0;
  for (const [bar, notes] of [...perBar.entries()].sort((a, b) => a[0] - b[0])) {
    if (notes.length === 0) continue;
    const sorted = [...notes].sort(
      (a, b) => a.beat - b.beat || a.band.localeCompare(b.band),
    );
    const sig = sorted.map((n) => `${n.beat}:${n.band}`).join("|");
    const seg = clusters.get(sig);
    if (seg) seg.bars.push(bar);
    else clusters.set(sig, { id: `seg-${idx++}`, notes: sorted, bars: [bar], beatsPerBar });
  }

  return [...clusters.values()]
    .filter((s) => s.bars.length >= 2 || s.notes.length >= 6)
    .sort(
      (a, b) => b.bars.length - a.bars.length || b.notes.length - a.notes.length,
    )
    .slice(0, 10);
}

/** 由勾选段落生成谱面（多段落重叠区域同键近邻去重） */
export function buildChart(opts: {
  segments: DrumSegment[];
  selectedIds: ReadonlySet<string>;
  bpm: number;
  offsetMs: number;
  timeSignature: [number, number];
  durationMs: number;
  title: string;
}): TaikoChart {
  const beatMs = 60000 / opts.bpm;
  const out: TaikoNote[] = [];
  for (const seg of opts.segments) {
    if (!opts.selectedIds.has(seg.id)) continue;
    for (const bar of seg.bars) {
      for (const n of seg.notes) {
        const timeMs = opts.offsetMs + (bar * seg.beatsPerBar + n.beat) * beatMs;
        if (timeMs < 0 || timeMs > opts.durationMs) continue;
        const midi = BAND_NOTE[n.band];
        const lane = getDrumLane(midi);
        if (!lane) continue;
        out.push({ timeMs, lane, note: midi });
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
