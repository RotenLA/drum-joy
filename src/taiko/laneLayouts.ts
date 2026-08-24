/**
 * 下落式模式：鼓件色板 / 分区布局 / 键盘映射 / 扇形鼓盘锚点
 *
 * 色值取自 AeroBand 鼓位图（两个踏板为补充定义，集中在此可改）。
 * 舞台下落式（stageRenderer）：9 个鼓盘按 PAD_ANCHORS 扇形排布，
 * 音符从顶部消失点沿辐射车道滑向鼓盘，鼓盘即判定落点。
 * Zone 的 x0/x1/t0/t1 地面矩形为旧渲染器遗留，当前仅分区/键盘映射在用。
 */

export type PartId =
  | "pedalHat"
  | "kick"
  | "hihat"
  | "crash"
  | "snare"
  | "highTom"
  | "midTom"
  | "floorTom"
  | "ride";

export interface DrumPart {
  id: PartId;
  label: string;
  notes: readonly number[];
  color: string;
}

export const DRUM_PARTS: readonly DrumPart[] = [
  { id: "pedalHat", label: "踩镲踏板", notes: [44], color: "#2DD4BF" },
  { id: "kick", label: "底鼓", notes: [35, 36], color: "#FF4D4D" },
  { id: "hihat", label: "踩镲", notes: [42, 46], color: "#F48419" },
  { id: "crash", label: "吊镲", notes: [49, 52], color: "#F1E12F" },
  { id: "snare", label: "军鼓", notes: [38, 40], color: "#5D8CF4" },
  { id: "highTom", label: "高通", notes: [48, 50], color: "#F978C1" },
  { id: "midTom", label: "中通", notes: [47], color: "#90FBE9" },
  { id: "floorTom", label: "地通", notes: [41, 43, 45], color: "#95F96F" },
  { id: "ride", label: "叮叮镲", notes: [51], color: "#8341F1" },
];

export const PART_BY_ID = Object.fromEntries(
  DRUM_PARTS.map((p) => [p.id, p]),
) as Record<PartId, DrumPart>;

export const PART_BY_NOTE: Readonly<Record<number, PartId>> = Object.fromEntries(
  DRUM_PARTS.flatMap((p) => p.notes.map((n) => [n, p.id])),
);

export type PadKind = "drum" | "cymbal" | "pedal";

/** 鼓盘在舞台上的摆位（归一化坐标，相对画布宽/高） */
export interface PadAnchor {
  /** 中心 x（0-1，相对画布宽） */
  cx: number;
  /** 中心 y（0-1，相对画布高，越大越靠近玩家） */
  cy: number;
  /** 横向半径（相对画布宽）；纵向半径按 kind 比例推算 */
  r: number;
  kind: PadKind;
  /** 方形鼓盘（脚踏板用，便于与手击鼓盘区分） */
  square?: boolean;
}

/**
 * 鼓盘阵（AeroBand 鼓位图布局，压缩在屏幕下 1/3）：
 * 上排 4 件（镲片两端 + 高/中通居中，偏远偏小）、
 * 中排 3 件（踩镲/军鼓/地通）、下排 2 踏板（最近最大）。
 * 摆位/大小要调整只改这张表。
 */
export const PAD_ANCHORS: Record<PartId, PadAnchor> = {
  // 上排（偏远偏小）
  crash: { cx: 0.16, cy: 0.66, r: 0.05, kind: "cymbal" },
  highTom: { cx: 0.38, cy: 0.66, r: 0.048, kind: "drum" },
  midTom: { cx: 0.62, cy: 0.66, r: 0.048, kind: "drum" },
  ride: { cx: 0.84, cy: 0.66, r: 0.05, kind: "cymbal" },
  // 中排（踩镲/地通内收，分别处于吊镲·高通与中通·叮叮镲的中下方）
  hihat: { cx: 0.27, cy: 0.79, r: 0.056, kind: "cymbal" },
  snare: { cx: 0.5, cy: 0.79, r: 0.06, kind: "drum" },
  floorTom: { cx: 0.73, cy: 0.79, r: 0.06, kind: "drum" },
  // 下排（最近一排，方形低趴踏板与手击鼓盘区分，两踏板等大，明显小于军鼓）
  pedalHat: { cx: 0.35, cy: 0.91, r: 0.045, kind: "pedal", square: true },
  kick: { cx: 0.65, cy: 0.91, r: 0.045, kind: "drum", square: true },
};

export type LayoutMode = "five" | "nine";

export interface Zone {
  id: string;
  label: string;
  parts: readonly PartId[];
  notes: readonly number[];
  /** 分区描边 / 辉光代表色 */
  color: string;
  pedal: boolean;
  /** 地面归一化矩形 */
  x0: number;
  x1: number;
  t0: number;
  t1: number;
  /** 键盘模拟按键（KeyboardEvent.key 小写） */
  key: string;
  keyLabel: string;
}

function makeZone(
  id: string,
  label: string,
  parts: readonly PartId[],
  rect: { x0: number; x1: number; t0: number; t1: number },
  key: string,
  keyLabel: string,
  color?: string,
): Zone {
  return {
    id,
    label,
    parts,
    notes: parts.flatMap((p) => PART_BY_ID[p].notes),
    color: color ?? PART_BY_ID[parts[0]!].color,
    pedal: parts.every((p) => p === "pedalHat" || p === "kick"),
    key,
    keyLabel,
    ...rect,
  };
}

/** 手区纵深（上半区） */
const HAND_T = { t0: 0.3, t1: 0.62 } as const;
/** 踏板纵深（更靠近玩家的低位横条） */
const PEDAL_T = { t0: 0.66, t1: 0.93 } as const;

/** 5 分区（默认，易上手）：下 2 踏板 + 上 3 手区 */
export const FIVE_ZONES: readonly Zone[] = [
  makeZone("left", "左区·镲", ["hihat", "crash"], { x0: 0.08, x1: 0.34, ...HAND_T }, "a", "A"),
  makeZone("mid", "中区·鼓", ["snare", "highTom", "midTom"], { x0: 0.37, x1: 0.63, ...HAND_T }, "s", "S"),
  makeZone("right", "右区·镲/地通", ["ride", "floorTom"], { x0: 0.66, x1: 0.92, ...HAND_T }, "d", "D"),
  makeZone("pedalL", "左踏板", ["pedalHat"], { x0: 0.18, x1: 0.45, ...PEDAL_T }, "f", "F"),
  makeZone("pedalR", "右踏板", ["kick"], { x0: 0.55, x1: 0.82, ...PEDAL_T }, "j", "J"),
];

/** 9 分区（进阶）：9 个部件各自独立，按鼓手视角排布 */
export const NINE_ZONES: readonly Zone[] = [
  makeZone("hihat", "踩镲", ["hihat"], { x0: 0.05, x1: 0.17, ...HAND_T }, "1", "1"),
  makeZone("crash", "吊镲", ["crash"], { x0: 0.18, x1: 0.3, ...HAND_T }, "2", "2"),
  makeZone("highTom", "高通", ["highTom"], { x0: 0.31, x1: 0.43, ...HAND_T }, "3", "3"),
  makeZone("snare", "军鼓", ["snare"], { x0: 0.44, x1: 0.56, ...HAND_T }, "4", "4"),
  makeZone("midTom", "中通", ["midTom"], { x0: 0.57, x1: 0.69, ...HAND_T }, "5", "5"),
  makeZone("floorTom", "地通", ["floorTom"], { x0: 0.7, x1: 0.82, ...HAND_T }, "6", "6"),
  makeZone("ride", "叮叮镲", ["ride"], { x0: 0.83, x1: 0.95, ...HAND_T }, "7", "7"),
  makeZone("pedalL", "踩镲踏板", ["pedalHat"], { x0: 0.18, x1: 0.45, ...PEDAL_T }, "f", "F"),
  makeZone("pedalR", "底鼓", ["kick"], { x0: 0.55, x1: 0.82, ...PEDAL_T }, "j", "J"),
];

export function zonesFor(mode: LayoutMode): readonly Zone[] {
  return mode === "five" ? FIVE_ZONES : NINE_ZONES;
}
