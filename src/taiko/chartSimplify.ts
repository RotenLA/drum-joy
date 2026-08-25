/**
 * 谱面密度档位：把编好的谱面简化到人手打得出来的密度。
 * 全程确定性——同输入同输出，不在重渲染时抖动。
 */
import type { TaikoChart, TaikoNote } from "@/shared/taikoChart";
import { partOfNote, type PartId } from "./laneLayouts";

export type Density = "easy" | "normal" | "raw";

export const DENSITY_LABEL: Record<Density, string> = {
  easy: "轻松",
  normal: "标准",
  raw: "原样",
};

interface DensityRule {
  /** 镲最大细分（每拍击数） */
  hatDiv: 1 | 2 | 4;
  /** 每小节音符上限（Infinity 表示不限） */
  maxPerBar: number;
  /** 相邻音符最小间隔 ms */
  minGapMs: number;
}

export const DENSITY_RULES: Record<Density, DensityRule> = {
  easy: { hatDiv: 1, maxPerBar: 6, minGapMs: 160 },
  normal: { hatDiv: 2, maxPerBar: 10, minGapMs: 110 },
  raw: { hatDiv: 4, maxPerBar: Infinity, minGapMs: 0 },
};

/** 优先级：越小越先保留 */
const PRIORITY: Record<PartId, number> = {
  kick: 0,
  snare: 1,
  hihat: 2,
  crash: 3,
  floorTom: 4,
  highTom: 5,
  midTom: 6,
  ride: 7,
  pedalHat: 8,
};

const partOf = (n: TaikoNote): PartId =>
  (n.note !== undefined ? partOfNote(n.note) : null) ?? "snare";

export function simplifyChart(
  chart: TaikoChart,
  opts: { density: Density; offsetMs: number; beatsPerBar: number },
): TaikoChart {
  const rule = DENSITY_RULES[opts.density];
  const beatMs = 60000 / chart.bpm;
  const barMs = beatMs * opts.beatsPerBar;
  const barOf = (t: number) => Math.floor((t - opts.offsetMs) / barMs);
  const beatInBar = (t: number) => ((t - opts.offsetMs) / beatMs) % opts.beatsPerBar;

  let notes = [...chart.notes].sort((a, b) => a.timeMs - b.timeMs);

  // 1) 镲细分降级：只保留落在允许网格上的镲
  if (rule.hatDiv < 4) {
    const gridBeats = 1 / rule.hatDiv;
    notes = notes.filter((n) => {
      if (partOf(n) !== "hihat") return true;
      const b = beatInBar(n.timeMs);
      const snapped = Math.round(b / gridBeats) * gridBeats;
      return Math.abs(b - snapped) < 0.06;
    });
  }

  // 2) 同一时刻多件同响 → 只保留优先级最高的一件
  const collapsed: TaikoNote[] = [];
  for (const n of notes) {
    const last = collapsed[collapsed.length - 1];
    if (last && Math.abs(last.timeMs - n.timeMs) < 40) {
      if (PRIORITY[partOf(n)] < PRIORITY[partOf(last)]) collapsed[collapsed.length - 1] = n;
      continue;
    }
    collapsed.push(n);
  }
  notes = collapsed;

  // 3) 最小间隔：低优先级的那一个先让位
  if (rule.minGapMs > 0) {
    const gapped: TaikoNote[] = [];
    for (const n of notes) {
      const last = gapped[gapped.length - 1];
      if (last && n.timeMs - last.timeMs < rule.minGapMs) {
        if (PRIORITY[partOf(n)] < PRIORITY[partOf(last)]) gapped[gapped.length - 1] = n;
        continue;
      }
      gapped.push(n);
    }
    notes = gapped;
  }

  // 4) 每小节上限：离强拍越远越先丢
  if (Number.isFinite(rule.maxPerBar)) {
    const byBar = new Map<number, TaikoNote[]>();
    for (const n of notes) {
      const bar = barOf(n.timeMs);
      const list = byBar.get(bar);
      if (list) list.push(n);
      else byBar.set(bar, [n]);
    }
    const keep = new Set<TaikoNote>();
    for (const list of byBar.values()) {
      const ranked = [...list].sort((a, b) => {
        const wa = weight(a);
        const wb = weight(b);
        return wa - wb || a.timeMs - b.timeMs;
      });
      for (const n of ranked.slice(0, rule.maxPerBar)) keep.add(n);
    }
    notes = notes.filter((n) => keep.has(n));
  }

  return { ...chart, notes };

  /** 保留权重：数值越小越该留（强拍 + 高优先级鼓件） */
  function weight(n: TaikoNote): number {
    const b = beatInBar(n.timeMs);
    const offGrid = Math.abs(b - Math.round(b)); // 0 = 正拍
    const strong = b < 0.06 ? 0 : Math.abs(b - Math.floor(opts.beatsPerBar / 2)) < 0.06 ? 0.4 : 1;
    return PRIORITY[partOf(n)] * 0.6 + strong + offGrid * 4;
  }
}
