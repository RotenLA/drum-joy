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

/** 横排列沿用舞台模式的偏航有效范围：y / YAW 只负责左右选列。 */
export const COLUMN_YAW_MIN = -90;
export const COLUMN_YAW_MAX = 92;

export function orderedColumnParts(parts: readonly PartId[]): PartId[] {
  const allowed = new Set(parts);
  return COLUMN_PART_ORDER.filter((part) => allowed.has(part));
}

export function columnPartOfYaw(
  yaw: number,
  parts: readonly PartId[],
  includePedals = true,
): PartId | null {
  const ordered = orderedColumnParts(parts).filter(
    (part) => includePedals || (part !== "pedalHat" && part !== "kick"),
  );
  if (ordered.length === 0) return null;
  const value = Number.isFinite(yaw) ? yaw : 0;
  const normalized = Math.max(
    0,
    Math.min(0.999999, (value - COLUMN_YAW_MIN) / (COLUMN_YAW_MAX - COLUMN_YAW_MIN)),
  );
  return ordered[Math.floor(normalized * ordered.length)] ?? null;
}

export function columnIndexOfYaw(yaw: number, parts: readonly PartId[]): number {
  const ordered = orderedColumnParts(parts);
  const part = columnPartOfYaw(yaw, parts);
  return part ? ordered.indexOf(part) : -1;
}