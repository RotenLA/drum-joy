/**
 * 全曲编谱：以基础节奏型（groovePatterns）为骨架逐小节铺谱，
 * 按小节活跃度分档降级/加变体，再按分区与密度档位收敛。
 * 同歌 + 同主型 + 同分区 + 同档位 → 结果完全一致（确定性哈希）。
 */
import { getDrumLane } from "@/shared/drumLaneMap";
import type { TaikoChart, TaikoNote } from "@/shared/taikoChart";
import type { LayoutMode, PartId } from "./laneLayouts";
import { VISIBLE_PARTS } from "./laneLayouts";
import { hatBeats, scaleBeats, type GroovePattern } from "./groovePatterns";
import { simplifyChart, type Density } from "./chartSimplify";
import type { BarBands } from "./drumAnalyze";

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

/** 5 分区不可见鼓件的替代（不是简单丢弃，保留该处有一击的感觉） */
const FIVE_SUB: Partial<Record<PartId, PartId>> = {
  crash: "hihat",
  ride: "hihat",
  highTom: "floorTom",
  midTom: "floorTom",
};

function stableUnit(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export interface ArrangeOptions {
  groove: GroovePattern;
  barActivity: readonly number[];
  barBands: readonly BarBands[];
  activeRange: [number, number] | null;
  layout: LayoutMode;
  density: Density;
  bpm: number;
  offsetMs: number;
  timeSignature: [number, number];
  durationMs: number;
  title: string;
}

export function arrangeChart(opts: ArrangeOptions): TaikoChart {
  const beatMs = 60000 / opts.bpm;
  const beatsPerBar = opts.timeSignature[0] * (4 / opts.timeSignature[1]);
  const groove = opts.groove;
  const visible = new Set<PartId>(VISIBLE_PARTS[opts.layout]);
  const out: TaikoNote[] = [];

  const resolve = (part: PartId): PartId | null => {
    if (visible.has(part)) return part;
    const sub = opts.layout === "five" ? FIVE_SUB[part] : undefined;
    return sub && visible.has(sub) ? sub : null;
  };

  const add = (bar: number, beat: number, rawPart: PartId) => {
    if (beat < 0 || beat >= beatsPerBar) return;
    const part = resolve(rawPart);
    if (!part) return;
    const timeMs = opts.offsetMs + (bar * beatsPerBar + beat) * beatMs;
    if (timeMs < 0 || timeMs > opts.durationMs) return;
    const midi = PART_NOTE[part];
    const lane = getDrumLane(midi);
    if (lane) out.push({ timeMs, lane, note: midi });
  };

  const kickBeats = scaleBeats(groove.kick, groove.beatsPerBar, beatsPerBar);
  const snareBeats = scaleBeats(groove.snare, groove.beatsPerBar, beatsPerBar);
  const range = opts.activeRange;

  if (range) {
    for (let bar = range[0]; bar <= range[1]; bar++) {
      const activity = opts.barActivity[bar] ?? 0;
      const prev = opts.barActivity[bar - 1] ?? activity;
      const bands = opts.barBands[bar];
      const seed = `${opts.title}|${groove.id}|${opts.layout}|${opts.density}|${bar}`;
      const phraseStart = bar === range[0] || bar % 8 === 0;
      const phraseEnd = bar === range[1] || (bar + 1) % 4 === 0;
      const rising = activity - prev > 0.18;

      // 活跃度 → 四档
      if (activity < 0.04) continue; // 几乎无鼓：留空

      if (activity < 0.18) {
        // 弱鼓段：只留镲或只留底鼓，按该小节哪一类更强
        const hatLead = (bands?.hihat ?? 0) >= (bands?.kick ?? 0);
        if (hatLead) {
          for (let beat = 0; beat < beatsPerBar; beat += 1) add(bar, beat, "hihat");
        } else {
          add(bar, 0, "kick");
          if (activity >= 0.1) add(bar, Math.floor(beatsPerBar / 2), "kick");
        }
        continue;
      }

      const full = activity >= 0.5;
      // 骨架
      for (const b of kickBeats) add(bar, b, "kick");
      for (const b of snareBeats) add(bar, b, "snare");
      const div = full ? groove.hatDiv : ((Math.max(1, groove.hatDiv / 2) as 1 | 2 | 4));
      for (const b of hatBeats(groove, beatsPerBar, div)) add(bar, b, "hihat");

      if (!full) continue;

      // 变体 / 装饰
      const veryStrong = activity >= 0.75;
      if (phraseStart && (veryStrong || rising)) add(bar, 0, "crash");
      if (phraseEnd && stableUnit(`${seed}|fill`) < (veryStrong ? 0.7 : 0.4)) {
        for (const hit of groove.fill) add(bar, beatsPerBar + hit.beat, hit.part);
      }
      if (veryStrong && stableUnit(`${seed}|tom`) < 0.2) {
        add(bar, Math.floor(beatsPerBar / 2) + 0.5, "highTom");
      }
      if (veryStrong && stableUnit(`${seed}|ride`) < 0.12) add(bar, 0, "ride");
      if (veryStrong && stableUnit(`${seed}|pedal`) < 0.12) {
        add(bar, Math.max(0, beatsPerBar - 1), "pedalHat");
      }
    }
  }

  out.sort((a, b) => a.timeMs - b.timeMs);
  const dedup: TaikoNote[] = [];
  for (const n of out) {
    let dup = false;
    for (let i = dedup.length - 1; i >= 0 && i >= dedup.length - 6; i--) {
      const m = dedup[i]!;
      if (m.note === n.note && Math.abs(m.timeMs - n.timeMs) < 40) {
        dup = true;
        break;
      }
    }
    if (!dup) dedup.push(n);
  }

  const chart: TaikoChart = {
    title: opts.title,
    bpm: opts.bpm,
    timeSignature: opts.timeSignature,
    durationMs: opts.durationMs,
    notes: dedup,
  };
  return simplifyChart(chart, {
    density: opts.density,
    offsetMs: opts.offsetMs,
    beatsPerBar,
  });
}
