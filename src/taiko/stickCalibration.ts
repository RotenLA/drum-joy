import { PAD_ANCHORS, type PartId } from "./laneLayouts";
import type { StickPose } from "./stickInput";

export const STICK_CALIBRATION_KEY = "taiko.stickCalib.v1";
export const STICK_LAYOUT_VERSION = "pads-18x9-v1";
export const CAPTURE_PARTS = ["crash", "highTom", "midTom", "ride", "hihat", "snare", "floorTom"] as const satisfies readonly PartId[];
export type StickSide = "l" | "r";
export type CapturePart = (typeof CAPTURE_PARTS)[number];
export interface StickSample extends StickPose { at: number }
export interface SampleGroup { samples: StickSample[]; median: StickPose; spread: number; rejected: number[] }
export type CaptureGroups = Partial<Record<CapturePart, Partial<Record<StickSide, SampleGroup>>>>;
export interface AffineFit { x: [number, number, number]; y: [number, number, number]; rmse: number }
export interface StickCalibrationFile {
  version: 1;
  createdAt: string;
  aspectRatio: "18:9";
  layoutVersion: string;
  anchors: Record<CapturePart, { cx: number; cy: number }>;
  groups: CaptureGroups;
  fit: Partial<Record<StickSide, AffineFit>>;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
export function summarizeSamples(samples: StickSample[]): SampleGroup {
  const mp = median(samples.map((s) => s.p));
  const my = median(samples.map((s) => s.y));
  const distances = samples.map((s) => Math.hypot(s.p - mp, s.y - my));
  const threshold = Math.max(2, median(distances) * 2.5);
  const rejected = distances.map((d, i) => (d > threshold ? i : -1)).filter((i) => i >= 0);
  const kept = samples.filter((_, i) => !rejected.includes(i));
  const center = { p: median(kept.map((s) => s.p)), y: median(kept.map((s) => s.y)) };
  const spread = Math.sqrt(kept.reduce((sum, s) => sum + (s.p - center.p) ** 2 + (s.y - center.y) ** 2, 0) / Math.max(1, kept.length));
  return { samples, median: center, spread, rejected };
}

function solve3(a: number[][], b: number[]): [number, number, number] | null {
  const m = a.map((row, i) => [...row, b[i] ?? 0]);
  for (let c = 0; c < 3; c++) {
    let pivot = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r]?.[c] ?? 0) > Math.abs(m[pivot]?.[c] ?? 0)) pivot = r;
    const tmp = m[c]; m[c] = m[pivot] ?? []; m[pivot] = tmp ?? [];
    const d = m[c]?.[c] ?? 0;
    if (Math.abs(d) < 1e-8) return null;
    for (let j = c; j < 4; j++) if (m[c]) m[c]![j] = (m[c]![j] ?? 0) / d;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r]?.[c] ?? 0;
      for (let j = c; j < 4; j++) if (m[r]) m[r]![j] = (m[r]![j] ?? 0) - f * (m[c]?.[j] ?? 0);
    }
  }
  return [m[0]?.[3] ?? 0, m[1]?.[3] ?? 0, m[2]?.[3] ?? 0];
}

function fitAxis(rows: number[][], targets: number[]): [number, number, number] | null {
  const ata = Array.from({ length: 3 }, () => [0, 0, 0]);
  const atb = [0, 0, 0];
  rows.forEach((row, i) => {
    for (let r = 0; r < 3; r++) {
      atb[r] = (atb[r] ?? 0) + (row[r] ?? 0) * (targets[i] ?? 0);
      for (let c = 0; c < 3; c++) if (ata[r]) ata[r]![c] = (ata[r]![c] ?? 0) + (row[r] ?? 0) * (row[c] ?? 0);
    }
  });
  return solve3(ata, atb);
}

export function fitSide(groups: CaptureGroups, side: StickSide): AffineFit | null {
  const points = CAPTURE_PARTS.flatMap((part) => {
    const group = groups[part]?.[side];
    return group ? [{ pose: group.median, target: PAD_ANCHORS[part] }] : [];
  });
  if (points.length < 3) return null;
  const rows = points.map(({ pose }) => [1, pose.y, pose.p]);
  const x = fitAxis(rows, points.map(({ target }) => target.cx));
  const y = fitAxis(rows, points.map(({ target }) => target.cy));
  if (!x || !y) return null;
  const error = points.reduce((sum, point) => {
    const row = [1, point.pose.y, point.pose.p];
    const px = row.reduce((v, n, i) => v + n * x[i]!, 0);
    const py = row.reduce((v, n, i) => v + n * y[i]!, 0);
    return sum + (px - point.target.cx) ** 2 + (py - point.target.cy) ** 2;
  }, 0);
  return { x, y, rmse: Math.sqrt(error / points.length) };
}

export function makeCalibration(groups: CaptureGroups): StickCalibrationFile {
  const anchors = Object.fromEntries(CAPTURE_PARTS.map((part) => [part, { cx: PAD_ANCHORS[part].cx, cy: PAD_ANCHORS[part].cy }])) as StickCalibrationFile["anchors"];
  const l = fitSide(groups, "l"); const r = fitSide(groups, "r");
  return { version: 1, createdAt: new Date().toISOString(), aspectRatio: "18:9", layoutVersion: STICK_LAYOUT_VERSION, anchors, groups, fit: { ...(l ? { l } : {}), ...(r ? { r } : {}) } };
}

let cached: StickCalibrationFile | null | undefined;
export function loadStickCalibration(): StickCalibrationFile | null {
  if (cached !== undefined) return cached;
  if (typeof localStorage === "undefined") return null;
  try { cached = validateCalibration(JSON.parse(localStorage.getItem(STICK_CALIBRATION_KEY) ?? "null")); } catch { cached = null; }
  return cached;
}
export function saveStickCalibration(file: StickCalibrationFile): void { cached = file; localStorage.setItem(STICK_CALIBRATION_KEY, JSON.stringify(file)); }
export function clearStickCalibration(): void {
  cached = null;
  stickyPart.l = null;
  stickyPart.r = null;
  localStorage.removeItem(STICK_CALIBRATION_KEY);
}
export function validateCalibration(raw: unknown): StickCalibrationFile | null {
  if (!raw || typeof raw !== "object") return null;
  const file = raw as Partial<StickCalibrationFile>;
  if (file.version !== 1 || file.aspectRatio !== "18:9" || file.layoutVersion !== STICK_LAYOUT_VERSION || !file.groups || !file.fit) return null;
  return file as StickCalibrationFile;
}
const SNAP_OUTER_DEG = 18;
const SNAP_FULL_DEG = 4;
const SNAP_MAX_WEIGHT = 0.9;
const SNAP_SWITCH_MARGIN_DEG = 2;
const stickyPart: Record<StickSide, CapturePart | null> = { l: null, r: null };

const angleDelta = (a: number, b: number) => {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
};

const poseDistance = (a: StickPose, b: StickPose) =>
  Math.hypot(a.p - b.p, angleDelta(a.y, b.y));

/**
 * 用每个鼓面的实测姿态做最近邻柔和吸附。
 *
 * 与仿射拟合不同，这里不会让少量角度误差把棒尖推到鼓阵之外：接近某个
 * 已采鼓面时才逐渐靠向其中心，离所有鼓面较远时仍沿用默认连续映射。
 * 切换鼓面保留 2° 滞后，避免在两个相邻采集中心之间快速抖动。
 */
export function calibratedPoint(pose: StickPose, side: StickSide): { x: number; y: number } | null {
  const calibration = loadStickCalibration();
  if (!calibration) return null;

  const candidates = CAPTURE_PARTS.flatMap((part) => {
    const group = calibration.groups[part]?.[side];
    return group ? [{ part, distance: poseDistance(pose, group.median) }] : [];
  }).sort((a, b) => a.distance - b.distance);
  const nearest = candidates[0];
  if (!nearest) return null;

  const previousPart = stickyPart[side];
  const previous = previousPart
    ? candidates.find((candidate) => candidate.part === previousPart)
    : undefined;
  const selected = previous && previous.distance <= nearest.distance + SNAP_SWITCH_MARGIN_DEG
    ? previous
    : nearest;
  stickyPart[side] = selected.part;

  if (selected.distance >= SNAP_OUTER_DEG) return null;

  const yaw = Math.max(-1, Math.min(1, pose.y / 45));
  const pitch = Math.max(-1, Math.min(1, pose.p / 45));
  const base = { x: 0.5 + yaw * 0.4, y: 0.6 - pitch * 0.26 };
  const anchor = calibration.anchors[selected.part] ?? PAD_ANCHORS[selected.part];
  const range = SNAP_OUTER_DEG - SNAP_FULL_DEG;
  const progress = Math.max(0, Math.min(1, (SNAP_OUTER_DEG - selected.distance) / range));
  const smooth = progress * progress * (3 - 2 * progress);
  const weight = SNAP_MAX_WEIGHT * smooth;

  return {
    x: base.x + (anchor.cx - base.x) * weight,
    y: base.y + (anchor.cy - base.y) * weight,
  };
}
