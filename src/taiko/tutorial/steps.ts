/**
 * 新手教学的课程定义与练习谱面生成。
 * 统一 4/4 拍、100 BPM，先 4 拍预热再出音符，连续完成 8 次算通过。
 */
import type { TaikoChart, TaikoNote } from "@/shared/taikoChart";
import { getMapping, type PartId } from "../laneLayouts";

export const TUTORIAL_BPM = 100;
export const BEAT_MS = 60000 / TUTORIAL_BPM;
/** 预热拍数（只响节拍器，不出音符） */
export const WARMUP_BEATS = 4;
/** 通过所需次数 */
export const TARGET = 8;
/** 教学只展示这五个部件 */
export const TUTORIAL_PARTS: readonly PartId[] = ["pedalHat", "kick", "hihat", "snare", "floorTom"];

/** 部件 → 用于渲染的 MIDI 音符（跟随当前映射） */
export function noteOfPart(part: PartId): number {
  return getMapping()[part][0] ?? 38;
}

export interface Lesson {
  id: string;
  /** 顶部标题，例如「短音符：军鼓」 */
  title: string;
  /** 动画教学页的说明文字 */
  demo: string[];
  /** 练习页的一句提示 */
  hint: string;
  /** 通过后的鼓励文字 */
  praise: string;
  /** 每 4 拍一循环的短音符安排（下标 = 拍） */
  pattern: readonly (readonly PartId[])[];
  /** 长音符：踩住某个踏板若干拍 */
  hold?: { part: PartId; beats: number };
}

export const LESSONS: readonly Lesson[] = [
  {
    id: "snare",
    title: "短音符 · 军鼓",
    demo: [
      "圆形的音符从上方沿车道落下，落到对应鼓面的那一刻敲下去。",
      "现在练习军鼓：蓝色的那一面，用鼓槌敲。",
    ],
    hint: "跟着节拍器，音符到军鼓时敲一下",
    praise: "军鼓稳了！节奏感很好。",
    pattern: [["snare"], ["snare"], ["snare"], ["snare"]],
  },
  {
    id: "kick",
    title: "短音符 · 底鼓",
    demo: ["底鼓是右脚的踏板，音符落到最下面那块方形时踩下去。"],
    hint: "音符到底鼓时用右脚踩一下",
    praise: "右脚踩得很准！",
    pattern: [["kick"], ["kick"], ["kick"], ["kick"]],
  },
  {
    id: "hold",
    title: "长音符 · 左踏板踩住",
    demo: [
      "带尾巴的长条是长音符，要一直按住，直到尾巴走完。",
      "左踏板踩住时踩镲是闭合的声音，这里请踩住 8 拍不要松。",
    ],
    hint: "左脚踩住左踏板，保持 8 拍",
    praise: "踩得很稳，闭镲的手感就是这样。",
    pattern: [],
    hold: { part: "pedalHat", beats: 8 },
  },
  {
    id: "hihat-snare",
    title: "组合 · 踩镲 + 军鼓",
    demo: ["踩镲每拍一下，军鼓落在第 2、4 拍，两只手轮流配合。"],
    hint: "踩镲每拍敲，军鼓在第 2、4 拍",
    praise: "双手配合成型了，这就是最常用的基础节奏。",
    pattern: [["hihat"], ["hihat", "snare"], ["hihat"], ["hihat", "snare"]],
  },
  {
    id: "hold-hihat",
    title: "组合 · 踩住左踏板 + 闭镲 8 下",
    demo: ["左脚一直踩住左踏板，同时用鼓槌敲踩镲 8 下，这样才是闭镲的声音。"],
    hint: "左脚踩住不放，踩镲连敲 8 下",
    praise: "闭镲连打完成，脚和手已经能分开控制了。",
    pattern: [["hihat"], ["hihat"], ["hihat"], ["hihat"]],
    hold: { part: "pedalHat", beats: 8 },
  },
  {
    id: "snare-kick",
    title: "组合 · 军鼓 + 底鼓",
    demo: ["底鼓落在第 1、3 拍，军鼓落在第 2、4 拍，手脚交替。"],
    hint: "底鼓第 1、3 拍，军鼓第 2、4 拍",
    praise: "手脚交替也没问题，可以去正式游玩了！",
    pattern: [["kick"], ["snare"], ["kick"], ["snare"]],
  },
];

/** 练习/演示谱面：按 pattern 铺 bars 个小节，长音符每 (beats+4) 拍一条 */
export function buildLessonChart(lesson: Lesson, bars: number): TaikoChart {
  const notes: TaikoNote[] = [];
  const beats = bars * 4;
  if (lesson.pattern.length > 0) {
    for (let i = 0; i < beats; i++) {
      const slot = lesson.pattern[i % lesson.pattern.length] ?? [];
      for (const part of slot) {
        notes.push({
          timeMs: (WARMUP_BEATS + i) * BEAT_MS,
          lane: part === "kick" || part === "pedalHat" ? "don" : "ka",
          note: noteOfPart(part),
        });
      }
    }
  }
  if (lesson.hold) {
    const cycle = lesson.hold.beats + 4;
    for (let start = 0; start < beats; start += cycle) {
      notes.push({
        timeMs: (WARMUP_BEATS + start) * BEAT_MS,
        lane: "don",
        note: noteOfPart(lesson.hold.part),
        holdMs: lesson.hold.beats * BEAT_MS,
      });
    }
  }
  notes.sort((a, b) => a.timeMs - b.timeMs);
  return {
    title: lesson.title,
    bpm: TUTORIAL_BPM,
    timeSignature: [4, 4],
    durationMs: (WARMUP_BEATS + beats + 4) * BEAT_MS,
    notes,
  };
}
