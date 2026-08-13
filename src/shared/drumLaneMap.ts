/**
 * 太鼓谱面「咚 / 嗒」映射表
 *
 * 规则：双脚 = 咚（DON，红），双手 = 嗒（KA，蓝）。
 * - 咚：36 底鼓、44 踩镲踏板
 * - 嗒：其余所有已知鼓件音符
 * - 未列出的音符：getDrumLane 返回 null，调用方忽略
 *
 * 纯常量 + 查表函数，无副作用，主进程与渲染进程均可 import。
 */

export type DrumLane = "don" | "ka";

/** 双脚触发的音符 —— 咚 */
export const FOOT_NOTES: readonly number[] = [36, 44];

/** 双手触发的音符 —— 嗒 */
export const HAND_NOTES: readonly number[] = [
  35, 38, 40, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52,
];

/** 咚组（与 FOOT_NOTES 同义，语义别名） */
export const DON_NOTES: readonly number[] = FOOT_NOTES;

/** 嗒组（与 HAND_NOTES 同义，语义别名） */
export const KA_NOTES: readonly number[] = HAND_NOTES;

/** 完整映射表 */
export const DRUM_LANE_MAP: Readonly<Record<number, DrumLane>> = {
  ...Object.fromEntries(FOOT_NOTES.map((n) => [n, "don" as DrumLane])),
  ...Object.fromEntries(HAND_NOTES.map((n) => [n, "ka" as DrumLane])),
};

/** 中英文名称，便于 UI 显示与调试 */
export const DRUM_NOTE_NAMES: Readonly<Record<number, string>> = {
  35: "原声底鼓 Acoustic Bass Drum",
  36: "底鼓 Bass Drum 1",
  38: "军鼓 Acoustic Snare",
  40: "电军鼓 Electric Snare",
  41: "低落地嗵 Low Floor Tom",
  42: "闭踩镲 Closed Hi-Hat",
  43: "高落地嗵 High Floor Tom",
  44: "踩镲踏板 Pedal Hi-Hat",
  45: "低嗵 Low Tom",
  46: "开踩镲 Open Hi-Hat",
  47: "低中嗵 Low-Mid Tom",
  48: "高中嗵 Hi-Mid Tom",
  49: "强音镲 Crash Cymbal 1",
  50: "高嗵 High Tom",
  51: "叮叮镲 Ride Cymbal 1",
  52: "中国镲 Chinese Cymbal",
};

/** 所有参与谱面的音符（升序） */
export const CHART_NOTES: readonly number[] = [...FOOT_NOTES, ...HAND_NOTES].sort(
  (a, b) => a - b,
);

/** 查表：未映射音符返回 null */
export function getDrumLane(note: number): DrumLane | null {
  return DRUM_LANE_MAP[note] ?? null;
}

/** 该音符是否参与谱面 */
export function isChartNote(note: number): boolean {
  return getDrumLane(note) !== null;
}

/** 显示名，未知音符回退为 "Note <n>" */
export function getDrumNoteName(note: number): string {
  return DRUM_NOTE_NAMES[note] ?? `Note ${note}`;
}
