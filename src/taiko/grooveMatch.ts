/**
 * 段落 → 基础节奏型匹配：把用户选中的主体段落转成同一套特征，
 * 与库中每型算加权距离（军鼓位置最重要，其次底鼓，镲细分最轻）。
 */
import type { DrumSegment } from "./drumAnalyze";
import { GROOVE_PATTERNS, hatBeats, scaleBeats, type GroovePattern } from "./groovePatterns";

const STEP = 0.25;

function toStepSet(beats: readonly number[], beatsPerBar: number): Set<number> {
  const set = new Set<number>();
  for (const b of beats) {
    const q = Math.round(b / STEP);
    if (q >= 0 && q < Math.round(beatsPerBar / STEP)) set.add(q);
  }
  return set;
}

function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 镲细分级别：由每小节镲击数推断 */
function hatDivOf(count: number, beatsPerBar: number): 1 | 2 | 4 {
  const perBeat = count / Math.max(1, beatsPerBar);
  if (perBeat >= 2.6) return 4;
  if (perBeat >= 1.4) return 2;
  return 1;
}

export interface GrooveScore {
  pattern: GroovePattern;
  score: number;
}

/** 对每个基础型打分（0–1，越大越像），按分数降序 */
export function scoreGrooves(
  segment: DrumSegment | null,
  bpm: number,
): GrooveScore[] {
  const beatsPerBar = segment?.beatsPerBar ?? 4;
  const segKick = toStepSet(
    segment?.notes.filter((n) => n.band === "kick").map((n) => n.beat) ?? [],
    beatsPerBar,
  );
  const segSnare = toStepSet(
    segment?.notes.filter((n) => n.band === "snare").map((n) => n.beat) ?? [],
    beatsPerBar,
  );
  const hatCount = segment?.notes.filter((n) => n.band === "hihat").length ?? 0;
  const segHatDiv = hatDivOf(hatCount, beatsPerBar);

  const scored = GROOVE_PATTERNS.map((pattern) => {
    const barMatch = pattern.beatsPerBar === beatsPerBar ? 1 : 0.55;
    const patKick = toStepSet(scaleBeats(pattern.kick, pattern.beatsPerBar, beatsPerBar), beatsPerBar);
    const patSnare = toStepSet(
      scaleBeats(pattern.snare, pattern.beatsPerBar, beatsPerBar),
      beatsPerBar,
    );
    const patHat = toStepSet(hatBeats(pattern, beatsPerBar), beatsPerBar);
    const snareSim = jaccard(segSnare, patSnare);
    const kickSim = jaccard(segKick, patKick);
    const hatSim = 1 - Math.abs(Math.log2(pattern.hatDiv) - Math.log2(segHatDiv)) / 2;
    const bpmFit =
      bpm >= pattern.bpm[0] && bpm <= pattern.bpm[1]
        ? 1
        : Math.max(
            0,
            1 -
              Math.min(
                Math.abs(bpm - pattern.bpm[0]),
                Math.abs(bpm - pattern.bpm[1]),
              ) / 60,
          );
    const density = patHat.size; // 仅用于并列时的稳定排序
    const score =
      (snareSim * 0.42 + kickSim * 0.3 + hatSim * 0.16 + bpmFit * 0.12) * barMatch -
      density * 1e-6;
    return { pattern, score };
  });
  return scored.sort((a, b) => b.score - a.score);
}

export function matchGroove(segment: DrumSegment | null, bpm: number): GroovePattern {
  const ranked = scoreGrooves(segment, bpm);
  return ranked[0]!.pattern;
}
