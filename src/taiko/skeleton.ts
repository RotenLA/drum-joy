/**
 * 拆解第二步：把干净事件表整理成「每小节骨架」。
 *
 * 每小节记录各鼓件落在哪些 16 分格、力度层级、镲的细分程度，
 * 并标出过门小节与乐句边界；三档难度都从这张骨架表生成谱面。
 */
import type { PartId } from "./laneLayouts";
import type { CleanedMidi, CleanHit } from "./midiClean";

export interface BarSkeleton {
  index: number;
  /** 该小节第一个网格步（绝对） */
  startStep: number;
  /** 部件 → 小节内网格位（0..stepsPerBar-1） */
  slots: Partial<Record<PartId, number[]>>;
  /** 部件 → 各位置力度 */
  vel: Partial<Record<PartId, Record<number, number>>>;
  /** 镲的细分：4=四分 8=八分 16=十六分 0=无 */
  hatDiv: 0 | 4 | 8 | 16;
  /** 小节内被判为「开镲」的踩镲网格位 */
  openHat: number[];
  /** 该小节镲片主体是叮叮镲 */
  ridePrimary: boolean;
  /** 过门小节（通鼓多 / 音符密度突出） */
  isFill: boolean;
  /** 乐句首（每 4 小节） */
  isPhraseStart: boolean;
  noteCount: number;
}

export interface Skeleton {
  bars: BarSkeleton[];
  stepsPerBar: number;
  stepsPerBeat: number;
  phaseSteps: number;
}

const TOM_PARTS: readonly PartId[] = ["highTom", "midTom", "floorTom"];

export function buildSkeleton(clean: CleanedMidi): Skeleton {
  const { hits, stepsPerBar, stepsPerBeat, phaseSteps } = clean;
  if (hits.length === 0) {
    return { bars: [], stepsPerBar, stepsPerBeat, phaseSteps };
  }
  const firstStep = hits[0]!.step;
  const lastStep = hits[hits.length - 1]!.step;
  const firstBar = Math.floor((firstStep - phaseSteps) / stepsPerBar);
  const lastBar = Math.floor((lastStep - phaseSteps) / stepsPerBar);

  const bars: BarSkeleton[] = [];
  for (let b = firstBar; b <= lastBar; b++) {
    bars.push({
      index: b - firstBar,
      startStep: phaseSteps + b * stepsPerBar,
      slots: {},
      vel: {},
      hatDiv: 0,
      ridePrimary: false,
      isFill: false,
      isPhraseStart: false,
      noteCount: 0,
    });
  }

  const barOf = (h: CleanHit) => Math.floor((h.step - phaseSteps) / stepsPerBar) - firstBar;
  for (const h of hits) {
    const bar = bars[barOf(h)];
    if (!bar) continue;
    const local = h.step - bar.startStep;
    if (local < 0 || local >= stepsPerBar) continue;
    (bar.slots[h.part] ??= []).push(local);
    (bar.vel[h.part] ??= {})[local] = h.velocity;
    bar.noteCount++;
  }

  const counts = bars.map((b) => b.noteCount).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 0;

  for (const bar of bars) {
    for (const key of Object.keys(bar.slots) as PartId[]) {
      bar.slots[key]!.sort((a, b) => a - b);
    }
    const hat = bar.slots.hihat ?? [];
    const ride = bar.slots.ride ?? [];
    const cymbal = hat.length >= ride.length ? hat : ride;
    bar.ridePrimary = ride.length > hat.length;
    bar.hatDiv = divOf(cymbal, stepsPerBar, stepsPerBeat);
    const toms = TOM_PARTS.reduce((n, p) => n + (bar.slots[p]?.length ?? 0), 0);
    bar.isFill = toms >= 3 || (median > 0 && bar.noteCount > median * 1.6 && toms >= 2);
    bar.isPhraseStart = bar.index % 4 === 0;
  }

  return { bars, stepsPerBar, stepsPerBeat, phaseSteps };
}

function divOf(slots: number[], stepsPerBar: number, stepsPerBeat: number): 0 | 4 | 8 | 16 {
  if (slots.length === 0) return 0;
  const beats = stepsPerBar / stepsPerBeat;
  const per = slots.length / beats;
  if (per >= 3) return 16;
  if (per >= 1.5) return 8;
  return 4;
}

/** 该小节某部件是否在指定网格位附近（±tol 格）有击打 */
export function hasNear(
  bar: BarSkeleton,
  part: PartId,
  local: number,
  tol = 1,
): number | null {
  const slots = bar.slots[part];
  if (!slots) return null;
  let best: number | null = null;
  let bestD = tol + 1;
  for (const s of slots) {
    const d = Math.abs(s - local);
    if (d <= tol && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
