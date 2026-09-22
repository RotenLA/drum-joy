import type { Language } from "../i18n";
import type { PartId } from "../laneLayouts";

export type TutorialKind = "device" | "parts" | "short" | "hold" | "combo" | "done";

export interface TutorialStep {
  kind: TutorialKind;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  targets?: readonly PartId[];
  needed?: number;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { kind: "device", titleZh: "连接适配器", titleEn: "Connect the adapter", bodyZh: "打开 PD2U / PD2MAX 适配器，并连接到设备。检测成功后即可继续。", bodyEn: "Turn on your PD2U / PD2MAX adapter and connect it to this device." },
  { kind: "device", titleZh: "连接鼓槌与踏板", titleEn: "Connect sticks and pedals", bodyZh: "随意敲击鼓槌并踩下踏板。检测到手部与脚部输入后即可继续。", bodyEn: "Strike with a stick and press a pedal. Continue after both inputs are detected." },
  { kind: "parts", titleZh: "认识鼓件", titleEn: "Meet the kit", bodyZh: "跟随舞台上的高亮认识鼓面与踏板。敲击任意鼓件可看到即时反馈。", bodyEn: "Follow the highlights to learn the pads and pedals. Strike any part for feedback." },
  { kind: "short", titleZh: "军鼓短音符", titleEn: "Snare notes", bodyZh: "四拍预热后跟着下落音符敲军鼓，连续正确 8 次通过。", bodyEn: "After four count-in beats, follow the falling snare notes. Hit 8 correctly in a row.", targets: ["snare"], needed: 8 },
  { kind: "short", titleZh: "底鼓短音符", titleEn: "Kick notes", bodyZh: "跟着下落音符踩右踏板，连续正确 8 次通过。", bodyEn: "Follow the falling notes with the right pedal. Hit 8 correctly in a row.", targets: ["kick"], needed: 8 },
  { kind: "hold", titleZh: "踩住长音符", titleEn: "Hold notes", bodyZh: "长条到达左踏板时踩住不放，直到长条结束。", bodyEn: "Hold the left pedal when the long note arrives, and release after it ends.", targets: ["pedalHat"], needed: 1 },
  { kind: "combo", titleZh: "踩镲与军鼓", titleEn: "Hi-hat and snare", bodyZh: "跟随交替音符敲击踩镲与军鼓，连续正确 8 次通过。", bodyEn: "Alternate between hi-hat and snare for 8 correct hits.", targets: ["hihat", "snare"], needed: 8 },
  { kind: "combo", titleZh: "踏板与踩镲", titleEn: "Pedal and hi-hat", bodyZh: "保持左踏板踩下，同时跟随音符敲击闭镲。", bodyEn: "Keep the left pedal held while following the closed hi-hat notes.", targets: ["pedalHat", "hihat"], needed: 8 },
  { kind: "combo", titleZh: "军鼓与底鼓", titleEn: "Snare and kick", bodyZh: "交替敲击军鼓与底鼓，连续正确 8 次完成组合练习。", bodyEn: "Alternate between snare and kick for 8 correct hits.", targets: ["snare", "kick"], needed: 8 },
  { kind: "done", titleZh: "教学完成", titleEn: "Tutorial complete", bodyZh: "你已经掌握基本演奏方法，现在可以选择歌曲开始游玩。", bodyEn: "You know the basics. Choose a song and start playing." },
];

const OTHER: Partial<Record<Language, { tutorial: string; leave: string; next: string; retry: string; skip: string; finish: string }>> = {
  "zh-TW": { tutorial: "教學", leave: "離開教學", next: "下一步", retry: "再練一次", skip: "跳過本節", finish: "開始選歌" },
  ja: { tutorial: "チュートリアル", leave: "終了", next: "次へ", retry: "もう一度", skip: "スキップ", finish: "曲を選ぶ" },
  ko: { tutorial: "튜토리얼", leave: "나가기", next: "다음", retry: "다시 연습", skip: "건너뛰기", finish: "곡 선택" },
  fr: { tutorial: "Tutoriel", leave: "Quitter", next: "Suivant", retry: "Réessayer", skip: "Passer", finish: "Choisir un titre" },
  de: { tutorial: "Tutorial", leave: "Verlassen", next: "Weiter", retry: "Nochmal", skip: "Überspringen", finish: "Song wählen" },
  it: { tutorial: "Tutorial", leave: "Esci", next: "Avanti", retry: "Riprova", skip: "Salta", finish: "Scegli brano" },
  es: { tutorial: "Tutorial", leave: "Salir", next: "Siguiente", retry: "Repetir", skip: "Saltar", finish: "Elegir canción" },
};

export function tutorialLabels(language: Language) {
  if (language === "zh-CN") return { tutorial: "教学", leave: "离开教学", next: "下一步", retry: "再练一次", skip: "跳过本节", finish: "开始选歌" };
  if (language === "en") return { tutorial: "Tutorial", leave: "Leave tutorial", next: "Next", retry: "Try again", skip: "Skip lesson", finish: "Choose a song" };
  return OTHER[language] ?? OTHER.en ?? { tutorial: "Tutorial", leave: "Leave", next: "Next", retry: "Retry", skip: "Skip", finish: "Choose a song" };
}