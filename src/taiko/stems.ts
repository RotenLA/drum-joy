/**
 * Stem 文件名解析与峰值计算。
 * 约定命名：xxx_Vocals.mp3 / xxx_Bass.mp3 / xxx_Drums.mp3 / xxx_Other.mp3 / xxx.mid，
 * 主文件名（去后缀、去 stem 标记）用于把音轨与 MIDI 配成一首歌。
 */

export const STEM_KINDS = ["vocals", "drums", "bass", "other"] as const;
export type StemKind = (typeof STEM_KINDS)[number];

export const STEM_LABEL: Record<StemKind, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
};

export interface StemTrack {
  buffer: AudioBuffer;
  fileName: string;
  /** 样本峰值（0~1），仅作展示与校验，音量 100% 即原始文件音量 */
  peak: number;
}

export type StemMap = Record<StemKind, StemTrack | null>;

export const emptyStems = (): StemMap => ({
  vocals: null,
  drums: null,
  bass: null,
  other: null,
});

const SUFFIX_RE = /_(vocals|drums|bass|other|inst|instrumental|accompaniment|no_?drums)$/i;

const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");

/** 解析音频文件名 → { base, kind }；无 stem 后缀时归为 other */
export function parseStemName(fileName: string): { base: string; kind: StemKind } {
  const stem = stripExt(fileName);
  const m = SUFFIX_RE.exec(stem);
  if (!m) return { base: stem, kind: "other" };
  const tag = m[1]!.toLowerCase();
  const kind: StemKind =
    tag === "vocals" ? "vocals" : tag === "drums" ? "drums" : tag === "bass" ? "bass" : "other";
  return { base: stem.slice(0, m.index), kind };
}

/** MIDI 文件名 → 主文件名（同样容忍 _Drums 之类的后缀） */
export function baseOfMidiName(fileName: string): string {
  const stem = stripExt(fileName);
  const m = SUFFIX_RE.exec(stem);
  return m ? stem.slice(0, m.index) : stem;
}

/** 计算 AudioBuffer 的样本峰值（抽样，避免大文件卡顿） */
export function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  const step = Math.max(1, Math.floor(buffer.length / 400000));
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i += step) {
      const v = Math.abs(data[i]!);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

export const stemsDurationMs = (stems: StemMap): number => {
  let max = 0;
  for (const k of STEM_KINDS) {
    const t = stems[k];
    if (t) max = Math.max(max, t.buffer.duration * 1000);
  }
  return max;
};

export const hasAnyStem = (stems: StemMap): boolean => STEM_KINDS.some((k) => stems[k] !== null);

/** 静音阈值：约 -24dBFS 以下视为空白（仅供诊断用途） */
const SILENCE_THRESHOLD = 10 ** (-24 / 20);


/** 单轨开头空白长度（毫秒）：首个超过给定阈值的样本时刻 */
export function leadSilenceMs(buffer: AudioBuffer, threshold = SILENCE_THRESHOLD): number {
  const sr = buffer.sampleRate;
  // 以 5ms 为一窗做粗扫，命中后在窗内细找，兼顾精度与速度
  const win = Math.max(1, Math.round(sr * 0.005));
  const len = buffer.length;
  const chans: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) chans.push(buffer.getChannelData(ch));
  for (let start = 0; start < len; start += win) {
    const end = Math.min(len, start + win);
    for (const data of chans) {
      for (let i = start; i < end; i++) {
        if (Math.abs(data[i]!) > threshold) return (i / sr) * 1000;
      }
    }
  }
  return (len / sr) * 1000;
}

// 开头静音裁剪与鼓声起振猜测已废弃：所有音频文件都预留一整小节，
// 计时基准改由 Metro（节拍器）轨解析出的绝对节拍轴提供，音频一律从 0ms 起播。


