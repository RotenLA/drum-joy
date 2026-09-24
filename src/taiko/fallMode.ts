import type { PartId } from "./laneLayouts";

export type FallMode = "stage" | "columns";

export const FALL_MODES: readonly FallMode[] = ["stage", "columns"];

/** 横排模式固定顺序：与实体鼓组从左到右一致。 */
export const COLUMN_PART_ORDER: readonly PartId[] = [
  "crash",
  "hihat",
  "highTom",
  "pedalHat",
  "snare",
  "kick",
  "midTom",
  "floorTom",
  "ride",
];

/**
 * 宿主现有 p 即 Height。军鼓中心固定在校准姿态附近 25°，
 * 两侧覆盖常见有效范围；真机复测只需调整这两个边界。
 */
export const HEIGHT_MIN = -20;
export const HEIGHT_MAX = 70;

export function orderedColumnParts(parts: readonly PartId[]): PartId[] {
  const allowed = new Set(parts);
  return COLUMN_PART_ORDER.filter((part) => allowed.has(part));
}

export function columnPartOfHeight(
  pitch: number,
  parts: readonly PartId[],
  includePedals = true,
): PartId | null {
  const ordered = orderedColumnParts(parts).filter(
    (part) => includePedals || (part !== "pedalHat" && part !== "kick"),
  );
  if (ordered.length === 0) return null;
  const value = Number.isFinite(pitch) ? pitch : 25;
  const normalized = Math.max(0, Math.min(0.999999, (value - HEIGHT_MIN) / (HEIGHT_MAX - HEIGHT_MIN)));
  return ordered[Math.floor(normalized * ordered.length)] ?? null;
}

export function columnIndexOfHeight(pitch: number, parts: readonly PartId[]): number {
  const ordered = orderedColumnParts(parts);
  const part = columnPartOfHeight(pitch, parts);
  return part ? ordered.indexOf(part) : -1;
}