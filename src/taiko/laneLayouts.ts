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
  /**
   * 横向半径：相对「16:9 参考宽」（= 画布高 × 16/9），不是画布宽，
   * 这样在 18:9 等更宽的画布里鼓阵不会被拉宽变形。
   */
  r: number;
  /** 纵向半径 / 横向半径（素材实测的透视压扁比；缺省 0.42） */
  ratio?: number;
  kind: PadKind;
  /** 所属排（0=上排 1=中排 2=踏板排）：车道收束段按排独立计算，同列车道接近平行 */
  row: 0 | 1 | 2;
  /** 方形鼓盘（脚踏板用，便于与手击鼓盘区分） */
  square?: boolean;
}

/**
 * 摆位与尺寸全部按官方「演奏 toast」参考图实测（1920×1080 归一化），
 * 半径统一乘 GAME_SCALE 让鼓面比参考图略小一点，更适合游戏视野。
 * 想整体调大调小只动 GAME_SCALE。
 */
const GAME_SCALE = 0.88;
const S = (r: number) => +(r * GAME_SCALE).toFixed(4);

export const PAD_ANCHORS: Record<PartId, PadAnchor> = {
  // 上排：两片镲（吊镲黄 / 叮叮镲紫）在最外侧，两个鼓垫（高通粉 / 中通青）居中
  crash: { cx: 0.2367, cy: 0.3347, r: S(0.0794), ratio: 0.608, kind: "cymbal", row: 0 },
  highTom: { cx: 0.4237, cy: 0.3699, r: S(0.0576), ratio: 0.703, kind: "drum", row: 0 },
  midTom: { cx: 0.5716, cy: 0.3699, r: S(0.0576), ratio: 0.703, kind: "drum", row: 0 },
  ride: { cx: 0.7583, cy: 0.3389, r: S(0.076), ratio: 0.631, kind: "cymbal", row: 0 },
  // 中排：踩镲（橙镲）/ 军鼓（蓝）/ 地通（绿）
  hihat: { cx: 0.3234, cy: 0.5949, r: S(0.0635), ratio: 0.608, kind: "cymbal", row: 1 },
  snare: { cx: 0.4982, cy: 0.6106, r: S(0.0617), ratio: 0.597, kind: "drum", row: 1 },
  floorTom: { cx: 0.6885, cy: 0.5713, r: S(0.0682), ratio: 0.665, kind: "drum", row: 1 },
  // 下排：两个踏板（左=踩镲踏板，右=底鼓），保持参考图原始大小
  pedalHat: { cx: 0.3951, cy: 0.85, r: 0.0201, ratio: 2.12, kind: "pedal", square: true, row: 2 },
  kick: { cx: 0.605, cy: 0.85, r: 0.0201, ratio: 2.12, kind: "pedal", square: true, row: 2 },
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
