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

  // 1) 镲细分降级：把镲吸附到允许网格（正拍优先），而不是整条丢弃
  if (rule.hatDiv < 4) {
    const gridBeats = 1 / rule.hatDiv;
    const seen = new Set<string>();
    const snappedNotes: TaikoNote[] = [];
    for (const n of notes) {
      if (partOf(n) !== "hihat" && partOf(n) !== "ride") {
        snappedNotes.push(n);
        continue;
      }
      const b = beatInBar(n.timeMs);
      const bar = barOf(n.timeMs);
      const snapped = Math.round(b / gridBeats) * gridBeats;
      if (snapped < 0 || snapped >= opts.beatsPerBar) continue;
      const key = `${bar}|${snapped.toFixed(3)}|${n.note}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const timeMs = opts.offsetMs + (bar * opts.beatsPerBar + snapped) * beatMs;
      snappedNotes.push({ ...n, timeMs });
    }
    notes = snappedNotes.sort((a, b) => a.timeMs - b.timeMs);
  }
  // 2) 同一时刻按肢体分组：脚（底鼓/踩镲踏板）与手各留优先级最高的一件
  //    （底鼓 + 镲同拍是最自然的鼓型，不应被合并掉）
  const clusters: TaikoNote[][] = [];
  for (const n of notes) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(last[0]!.timeMs - n.timeMs) < 40) last.push(n);
    else clusters.push([n]);
  }
  const isFoot = (n: TaikoNote) => {
    const p = partOf(n);
    return p === "kick" || p === "pedalHat";
  };
  const reduced: TaikoNote[][] = clusters.map((group) => {
    const pick = (list: TaikoNote[]) =>
      list.length === 0
        ? null
        : list.reduce((a, b) => (PRIORITY[partOf(b)] < PRIORITY[partOf(a)] ? b : a));
    const foot = pick(group.filter(isFoot));
    const hand = pick(group.filter((n) => !isFoot(n)));
    return [foot, hand].filter((n): n is TaikoNote => n !== null);
  });

  // 3) 最小间隔：整簇之间保持间隔，低优先级的簇先让位
  let kept = reduced;
  if (rule.minGapMs > 0) {
    const gapped: TaikoNote[][] = [];
    for (const group of kept) {
      const last = gapped[gapped.length - 1];
      if (last && group[0]!.timeMs - last[0]!.timeMs < rule.minGapMs) {
        const bestNew = Math.min(...group.map((n) => PRIORITY[partOf(n)]));
        const bestOld = Math.min(...last.map((n) => PRIORITY[partOf(n)]));
        if (bestNew < bestOld) gapped[gapped.length - 1] = group;
        continue;
      }
      gapped.push(group);
    }
    kept = gapped;
  }
  notes = kept.flat();


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
