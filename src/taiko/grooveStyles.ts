/**
 * 倾向风格：在基础骨架之上调整「装饰概率 + 镲件选择 + 摇摆量」，
 * 不改主骨架（底鼓/军鼓位置），保证同歌同设定结果一致。
 */

export type StyleId =
  | "pop"
  | "folk"
  | "rock"
  | "funk"
  | "jazz"
  | "blues"
  | "electronic"
  | "world";

export interface GrooveStyle {
  id: StyleId;
  label: string;
  /** 镲细分偏移：-1 更疏、0 不变、+1 更密 */
  hatDivBias: -1 | 0 | 1;
  /** 摇摆量（占一拍比例，0 = 平均八分） */
  swing: number;
  /** 主奏镲件是否用叮叮镲 */
  rideLead: boolean;
  /** 踩镲踏板落 2/4 拍（爵士/世界） */
  pedalOnBackbeat: boolean;
  crashProb: number;
  fillProb: number;
  tomProb: number;
  /** ghost 军鼓（弱拍轻击）概率 */
  ghostProb: number;
  /** 底鼓切分（额外的十六分底鼓）概率 */
  kickSyncProb: number;
}

export const GROOVE_STYLES: readonly GrooveStyle[] = [
  {
    id: "pop",
    label: "流行",
    hatDivBias: 0,
    swing: 0,
    rideLead: false,
    pedalOnBackbeat: false,
    crashProb: 0.3,
    fillProb: 0.2,
    tomProb: 0.06,
    ghostProb: 0,
    kickSyncProb: 0.05,
  },
  {
    id: "folk",
    label: "民谣",
    hatDivBias: -1,
    swing: 0,
    rideLead: false,
    pedalOnBackbeat: false,
    crashProb: 0.15,
    fillProb: 0.12,
    tomProb: 0,
    ghostProb: 0.05,
    kickSyncProb: 0,
  },
  {
    id: "rock",
    label: "摇滚",
    hatDivBias: 0,
    swing: 0,
    rideLead: false,
    pedalOnBackbeat: false,
    crashProb: 0.75,
    fillProb: 0.5,
    tomProb: 0.3,
    ghostProb: 0.05,
    kickSyncProb: 0.12,
  },
  {
    id: "funk",
    label: "放克",
    hatDivBias: 1,
    swing: 0,
    rideLead: false,
    pedalOnBackbeat: false,
    crashProb: 0.25,
    fillProb: 0.45,
    tomProb: 0.15,
    ghostProb: 0.5,
    kickSyncProb: 0.55,
  },
  {
    id: "jazz",
    label: "爵士",
    hatDivBias: 0,
    swing: 0.167,
    rideLead: true,
    pedalOnBackbeat: true,
    crashProb: 0.15,
    fillProb: 0.3,
    tomProb: 0.1,
    ghostProb: 0.35,
    kickSyncProb: 0.08,
  },
  {
    id: "blues",
    label: "布鲁斯",
    hatDivBias: 0,
    swing: 0.167,
    rideLead: false,
    pedalOnBackbeat: false,
    crashProb: 0.2,
    fillProb: 0.18,
    tomProb: 0.05,
    ghostProb: 0.1,
    kickSyncProb: 0.05,
  },
  {
    id: "electronic",
    label: "电子",
    hatDivBias: 1,
    swing: 0,
    rideLead: false,
    pedalOnBackbeat: false,
    crashProb: 0.35,
    fillProb: 0.1,
    tomProb: 0,
    ghostProb: 0,
    kickSyncProb: 0.2,
    // 四踩倾向在编谱器里按 fourOnFloor 处理
  },
  {
    id: "world",
    label: "世界",
    hatDivBias: 0,
    swing: 0,
    rideLead: false,
    pedalOnBackbeat: true,
    crashProb: 0.1,
    fillProb: 0.35,
    tomProb: 0.55,
    ghostProb: 0.3,
    kickSyncProb: 0.3,
  },
];

export const STYLE_BY_ID = Object.fromEntries(
  GROOVE_STYLES.map((s) => [s.id, s]),
) as Record<StyleId, GrooveStyle>;

export const DEFAULT_STYLE: StyleId = "pop";

export function isStyleId(v: unknown): v is StyleId {
  return typeof v === "string" && v in STYLE_BY_ID;
}

/** 电子风格：底鼓倾向四踩 */
export const FOUR_ON_FLOOR_STYLES: ReadonlySet<StyleId> = new Set<StyleId>(["electronic"]);
