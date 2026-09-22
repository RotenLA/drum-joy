/**
 * 鼓棒定位：直接采用宿主（开发）给出的真实鼓面角度分区标定，
 * 不再需要网页端自己做「位置捕捉」采集与仿射拟合。
 *
 * 开发提供的判定标准（Vector2：x = 偏航/左右，y = 俯仰/上下，单位度）：
 *   俯仰分水岭 pitchingBorder = 21
 *   上层（y > 21）：x < -38.5 吊镲 | -38.5~4 高通 | 4~52 中通 | x > 52 叮叮镲
 *   下层（y ≤ 21）：x ≤ -26 踩镲 | -26~23 军鼓 | x ≥ 23 地通
 *
 * 映射策略：每个分区把偏航角按区间线性映射到该鼓盘的横向范围（分区中心 →
 * 鼓盘中心，分区边界 → 两鼓之间的中缝），上下两层各算一次再按俯仰角平滑过渡，
 * 因此角度落在某个分区内时棒尖必定落在这个鼓面上，且移动连续无跳格。
 */

import { PAD_ANCHORS, type PartId } from "./laneLayouts";
import type { StickPose } from "./stickInput";

/** 俯仰分水岭（度）：开发端 pitchingBorder */
export const PITCH_BORDER = 21;
export type StickLayer = "upper" | "lower";

interface Zone {
  part: PartId;
  /** 偏航角区间（度）；最外侧分区用合理外延值收边 */
  lo: number;
  hi: number;
}

/** 上层四件（俯仰抬起） */
const UPPER_ZONES: readonly Zone[] = [
  { part: "crash", lo: -72, hi: -38.5 },
  { part: "highTom", lo: -38.5, hi: 4 },
  { part: "midTom", lo: 4, hi: 52 },
  { part: "ride", lo: 52, hi: 92 },
];

/** 下层三件（俯仰放平） */
const LOWER_ZONES: readonly Zone[] = [
  { part: "hihat", lo: -66, hi: -26 },
  { part: "snare", lo: -26, hi: 23 },
  { part: "floorTom", lo: 23, hi: 64 },
];

/** 俯仰可用范围：上层向上、下层向下各留一段行程用于纵向微调 */
const PITCH_UPPER_TOP = 58;
const PITCH_LOWER_BOTTOM = -18;
/** 纵向只做极轻微跟随；上下层幅度完全一致。 */
const PITCH_SHIFT = 0.012;
/** 两排鼓面之间的中线，棒尖仅靠姿态绝不越过它。 */
const ROW_MID_Y = 0.475;
const ROW_GUARD = 0.018;

interface ControlPoint {
  deg: number;
  x: number;
  y: number;
}

/** 由分区表构造「偏航角 → 归一化坐标」的单调控制点（中心点 + 分区中缝） */
function buildTrack(zones: readonly Zone[]): ControlPoint[] {
  const points: ControlPoint[] = [];
  zones.forEach((zone, i) => {
    const a = PAD_ANCHORS[zone.part];
    const prev = zones[i - 1];
    const next = zones[i + 1];
    const seamX = (other: Zone | undefined, edge: number) => {
      if (!other) return { deg: edge, x: a.cx + (edge < (zone.lo + zone.hi) / 2 ? -1 : 1) * 0.045, y: a.cy };
      const b = PAD_ANCHORS[other.part];
      return { deg: edge, x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 };
    };
    if (i === 0) points.push(seamX(prev, zone.lo));
    points.push({ deg: (zone.lo + zone.hi) / 2, x: a.cx, y: a.cy });
    points.push(seamX(next, zone.hi));
  });
  return points.sort((p, q) => p.deg - q.deg);
}

const UPPER_TRACK = buildTrack(UPPER_ZONES);
const LOWER_TRACK = buildTrack(LOWER_ZONES);

/** 沿控制点做分段线性插值（超出两端按端点线性外延，幅度收敛） */
function sampleTrack(track: readonly ControlPoint[], deg: number): { x: number; y: number } {
  const first = track[0]!;
  const last = track[track.length - 1]!;
  if (deg <= first.deg) return { x: first.x + (deg - first.deg) * 0.0015, y: first.y };
  if (deg >= last.deg) return { x: last.x + (deg - last.deg) * 0.0015, y: last.y };
  for (let i = 1; i < track.length; i++) {
    const b = track[i]!;
    if (deg > b.deg) continue;
    const a = track[i - 1]!;
    const span = b.deg - a.deg || 1;
    const t = (deg - a.deg) / span;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return { x: last.x, y: last.y };
}

const smoothstep = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** 按开发标定判定当前角度指向哪个鼓面（用于调试展示） */
export function partOfPose(pose: StickPose): PartId {
  const zones = pose.p > PITCH_BORDER ? UPPER_ZONES : LOWER_ZONES;
  const hit = zones.find((z) => pose.y >= z.lo && pose.y < z.hi);
  return (hit ?? (pose.y < 0 ? zones[0]! : zones[zones.length - 1]!)).part;
}

/**
 * 棒尖落点（归一化 0-1，x 相对 16:9 参考宽、y 相对画布高）。
 * 横向由偏航角分区决定，纵向为所在层鼓盘高度 + 俯仰角微调。
 */
export function stickPoint(
  pose: StickPose,
  layer: StickLayer = "lower",
  layerMix?: number,
): { x: number; y: number } {
  const yaw = Number.isFinite(pose.y) ? pose.y : 0;
  const pitch = Number.isFinite(pose.p) ? pose.p : 0;

  const upper = sampleTrack(UPPER_TRACK, yaw);
  const lower = sampleTrack(LOWER_TRACK, yaw);
  const w = layerMix === undefined ? (layer === "upper" ? 1 : 0) : smoothstep(layerMix);

  // 两层采用相同幅度的轻微纵向跟随，且分别锁在中线两侧。
  const pitchT = smoothstep((pitch - PITCH_LOWER_BOTTOM) / (PITCH_UPPER_TOP - PITCH_LOWER_BOTTOM));
  const shift = (0.5 - pitchT) * PITCH_SHIFT * 2;
  const upperY = Math.min(ROW_MID_Y - ROW_GUARD, upper.y + shift);
  const lowerY = Math.max(ROW_MID_Y + ROW_GUARD, lower.y + shift);

  const x = lower.x + (upper.x - lower.x) * w;
  const y = lowerY + (upperY - lowerY) * w;

  return { x: Math.max(0.03, Math.min(0.97, x)), y: Math.max(0.05, Math.min(0.95, y)) };
}
