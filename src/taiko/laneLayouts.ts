/**
 * 下落式模式：鼓件色板 / 扇形鼓盘锚点 / 分区显示集 / 键盘调试映射，
 * 以及「部件 → MIDI 音符」映射（映射屏可改，localStorage 持久化）。
 *
 * 色值取自 AeroBand 鼓位图（两个踏板为补充定义，集中在此可改）。
 * 舞台下落式（stageRenderer）：鼓盘按 PAD_ANCHORS 扇形排布，
 * 音符从顶部收束段沿车道滑向鼓盘，鼓盘即判定落点。
 */

import { localize, type Language } from "./i18n";

export type PartId =
  "pedalHat" | "kick" | "hihat" | "crash" | "snare" | "highTom" | "midTom" | "floorTom" | "ride";

export interface DrumPart {
  id: PartId;
  label: string;
  /** 英文名（界面切到 English 时使用） */
  labelEn: string;
  /** 默认映射的 MIDI 音符（映射屏修改后以 localStorage 为准） */
  notes: readonly number[];
  color: string;
}

export const DRUM_PARTS: readonly DrumPart[] = [
  { id: "pedalHat", label: "踩镲踏板", labelEn: "Hi-hat Pedal", notes: [44], color: "#FFB65C" },
  { id: "kick", label: "底鼓", labelEn: "Kick", notes: [35, 36], color: "#FF7A29" },
  { id: "hihat", label: "踩镲", labelEn: "Hi-hat", notes: [42, 46], color: "#F48419" },
  { id: "crash", label: "吊镲", labelEn: "Crash", notes: [49, 52], color: "#F1E12F" },
  { id: "snare", label: "军鼓", labelEn: "Snare", notes: [38, 40], color: "#5D8CF4" },
  { id: "highTom", label: "高通", labelEn: "High Tom", notes: [48, 50], color: "#F978C1" },
  { id: "midTom", label: "中通", labelEn: "Mid Tom", notes: [47], color: "#90FBE9" },
  { id: "floorTom", label: "地通", labelEn: "Floor Tom", notes: [41, 43, 45], color: "#95F96F" },
  { id: "ride", label: "叮叮镲", labelEn: "Ride", notes: [51], color: "#8341F1" },
];

/** 按当前语言取鼓件名 */
export function partLabel(part: DrumPart, language: string): string {
  return localize(language as Language, part.label, part.labelEn);
}

export const PART_BY_ID = Object.fromEntries(DRUM_PARTS.map((p) => [p.id, p])) as Record<
  PartId,
  DrumPart
>;

// ================= 部件映射（note → part） =================

export type DrumMapping = Record<PartId, number[]>;

const MAPPING_KEY = "taiko.mapping.v1";

export function defaultMapping(): DrumMapping {
  const m = {} as Record<PartId, number[]>;
  for (const p of DRUM_PARTS) m[p.id] = [...p.notes];
  return m;
}

function loadMapping(): DrumMapping {
  if (typeof localStorage === "undefined") return defaultMapping();
  try {
    const raw = localStorage.getItem(MAPPING_KEY);
    if (!raw) return defaultMapping();
    const parsed = JSON.parse(raw) as Partial<Record<PartId, unknown>>;
    const base = defaultMapping() as Record<PartId, number[]>;
    for (const p of DRUM_PARTS) {
      const v = parsed[p.id];
      if (Array.isArray(v)) {
        base[p.id] = v.filter(
          (n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 127,
        );
      }
    }
    return base;
  } catch {
    return defaultMapping();
  }
}

let currentMapping: DrumMapping = loadMapping();

export function getMapping(): DrumMapping {
  return currentMapping;
}

export function setMapping(m: DrumMapping): void {
  currentMapping = m;
  try {
    localStorage.setItem(MAPPING_KEY, JSON.stringify(m));
  } catch {
    // 存储不可用时仅保留内存态
  }
}

export function resetMapping(): DrumMapping {
  const m = defaultMapping();
  setMapping(m);
  return m;
}

/** 音符 → 部件（按当前映射；未映射返回 null） */
export function partOfNote(note: number): PartId | null {
  for (const p of DRUM_PARTS) {
    if (currentMapping[p.id].includes(note)) return p.id;
  }
  return null;
}

// ================= 鼓盘摆位 =================

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
  /** 所属排（0=上排 1=中排 2=踏板排）：车道收束段按排独立计算，同列车道接近平行 */
  row: 0 | 1 | 2;
  /** 方形鼓盘（脚踏板用，便于与手击鼓盘区分） */
  square?: boolean;
}

/** 上排中心高度：按 ~16:9 画布标定，旋转后顶缘（鼓阵最高点）落在屏高 1/2 处，微调只改这个数 */
const TOP_ROW_CY = 0.568;
/** 中排中心高度（与上排保持 0.16 排距，整体随之上移） */
const MID_ROW_CY = 0.728;
/** 上排横坐标：中排踩镲/地通的车道端点取相邻上排两端点的正中 */
const TOP_CX = { crash: 0.16, highTom: 0.38, midTom: 0.62, ride: 0.84 } as const;

/** 鼓盘半径（整体缩小约 12%，音符仍取鼓面 70%） */
const PAD_R = 0.042;
const PEDAL_R = 0.04;

export const PAD_ANCHORS: Record<PartId, PadAnchor> = {
  // 上排（row 0，全员圆柱同尺寸）
  crash: { cx: TOP_CX.crash, cy: TOP_ROW_CY, r: PAD_R, kind: "drum", row: 0 },
  highTom: { cx: TOP_CX.highTom, cy: TOP_ROW_CY, r: PAD_R, kind: "drum", row: 0 },
  midTom: { cx: TOP_CX.midTom, cy: TOP_ROW_CY, r: PAD_R, kind: "drum", row: 0 },
  ride: { cx: TOP_CX.ride, cy: TOP_ROW_CY, r: PAD_R, kind: "drum", row: 0 },
  // 中排（row 1，车道端点分别处于吊镲/高通与中通/叮叮镲端点的正中）
  hihat: {
    cx: (TOP_CX.crash + TOP_CX.highTom) / 2,
    cy: MID_ROW_CY,
    r: PAD_R,
    kind: "drum",
    row: 1,
  },
  snare: { cx: 0.5, cy: MID_ROW_CY, r: PAD_R, kind: "drum", row: 1 },
  floorTom: {
    cx: (TOP_CX.midTom + TOP_CX.ride) / 2,
    cy: MID_ROW_CY,
    r: PAD_R,
    kind: "drum",
    row: 1,
  },
  // 下排（row 2，方形踏板与手击鼓盘区分，两踏板等大）
  pedalHat: { cx: 0.35, cy: 0.92, r: PEDAL_R, kind: "pedal", square: true, row: 2 },
  kick: { cx: 0.65, cy: 0.92, r: PEDAL_R, kind: "drum", square: true, row: 2 },
};

// ================= 分区显示集 =================

export type LayoutMode = "five" | "seven" | "nine";

/**
 * 各分区模式显示的鼓盘：
 * 5 分区只显示 底鼓 / 踩镲踏板 / 开闭镲 / 军鼓 / 地通 5 件，
 * 谱面中其他部件的音符直接丢弃；9 分区显示全部。
 */
export const VISIBLE_PARTS: Record<LayoutMode, readonly PartId[]> = {
  five: ["hihat", "snare", "floorTom", "pedalHat", "kick"],
  // 标准 7 分区：入门 5 件 + 吊镲、叮叮镲（不含高通、中通）
  seven: ["hihat", "snare", "floorTom", "pedalHat", "kick", "crash", "ride"],
  nine: ["pedalHat", "kick", "hihat", "crash", "snare", "highTom", "midTom", "floorTom", "ride"],
};

/** 键盘调试按键（无 MIDI 设备时模拟击打；两模式一致） */
export const KEY_BY_PART: Record<PartId, { key: string; label: string }> = {
  crash: { key: "q", label: "Q" },
  highTom: { key: "w", label: "W" },
  midTom: { key: "e", label: "E" },
  ride: { key: "r", label: "R" },
  hihat: { key: "a", label: "A" },
  snare: { key: "s", label: "S" },
  floorTom: { key: "d", label: "D" },
  pedalHat: { key: "f", label: "F" },
  kick: { key: "j", label: "J" },
};
