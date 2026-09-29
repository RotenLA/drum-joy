import type { Language } from "../i18n";
import type { PartId } from "../laneLayouts";

export type TutorialKind = "parts" | "short" | "hold" | "combo" | "done";

export interface TutorialStep {
  kind: TutorialKind;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  targets?: readonly PartId[];
  needed?: number;
}

export const TUTORIAL_STEPS: readonly [TutorialStep, ...TutorialStep[]] = [
  { kind: "parts", titleZh: "认识鼓件", titleEn: "Meet the kit", bodyZh: "依次敲击每个鼓面与踏板，画面上对应的位置会亮起，熟悉一下摆位。", bodyEn: "Strike each pad and pedal in turn; the matching spot lights up so you learn the layout." },
  { kind: "short", titleZh: "军鼓短音符", titleEn: "Snare notes", bodyZh: "四拍预热后跟着下落音符敲军鼓，连续正确 8 次通过。", bodyEn: "After four count-in beats, follow the falling snare notes. Hit 8 correctly in a row.", targets: ["snare"], needed: 8 },
  { kind: "short", titleZh: "底鼓短音符", titleEn: "Kick notes", bodyZh: "跟着下落音符踩右踏板，连续正确 8 次通过。", bodyEn: "Follow the falling notes with the right pedal. Hit 8 correctly in a row.", targets: ["kick"], needed: 8 },
  { kind: "hold", titleZh: "踩住长音符", titleEn: "Hold notes", bodyZh: "长条到达左踏板时踩住不放，直到长条结束。", bodyEn: "Hold the left pedal when the long note arrives, and release after it ends.", targets: ["pedalHat"], needed: 1 },
  { kind: "combo", titleZh: "踩镲与军鼓", titleEn: "Hi-hat and snare", bodyZh: "跟随交替音符敲击踩镲与军鼓，连续正确 8 次通过。", bodyEn: "Alternate between hi-hat and snare for 8 correct hits.", targets: ["hihat", "snare"], needed: 8 },
  { kind: "combo", titleZh: "踏板与踩镲", titleEn: "Pedal and hi-hat", bodyZh: "左踏板会分别与开镲、闭镲严格同时落下；每组一起命中才算一次，连续正确 8 次通过。", bodyEn: "The left pedal falls exactly with alternating open and closed hi-hat notes. Hit each pair together, 8 times in a row.", targets: ["pedalHat", "hihat"], needed: 8 },
  { kind: "combo", titleZh: "军鼓与底鼓", titleEn: "Snare and kick", bodyZh: "交替敲击军鼓与底鼓，连续正确 8 次完成组合练习。", bodyEn: "Alternate between snare and kick for 8 correct hits.", targets: ["snare", "kick"], needed: 8 },
  { kind: "done", titleZh: "教学完成", titleEn: "Tutorial complete", bodyZh: "你已经掌握基本演奏方法，现在可以选择歌曲开始游玩。", bodyEn: "You know the basics. Choose a song and start playing." },
];

export function tutorialStepCopy(language: Language, index: number, step: TutorialStep) {
  if (language === "zh-CN") return { title: step.titleZh, body: step.bodyZh };
  return { title: step.titleEn, body: step.bodyEn };
}

export interface TutorialLabels { tutorial: string; leave: string; next: string; retry: string; skip: string; finish: string; complete: string; progress: string; holding: string; stick: string; pedal: string; adapter: string; kitOn?: string; kitOff?: string }
export function tutorialLabels(language: Language): TutorialLabels {
  if (language === "zh-CN") return { tutorial: "教学", leave: "离开教学", next: "下一步", retry: "再练一次", skip: "跳过本节", finish: "开始选歌", complete: "完成！", progress: "练习进度", holding: "保持踩住", stick: "鼓槌输入", pedal: "踏板输入", adapter: "适配器", kitOn: "手机音色 开", kitOff: "手机音色 关" };
  return { tutorial: "Tutorial", leave: "Leave tutorial", next: "Next", retry: "Try again", skip: "Skip lesson", finish: "Choose a song", complete: "Complete!", progress: "Progress", holding: "Keep holding", stick: "Stick input", pedal: "Pedal input", adapter: "Adapter", kitOn: "Mobile sound on", kitOff: "Mobile sound off" };
}