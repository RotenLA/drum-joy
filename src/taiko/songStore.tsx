/**
 * 歌曲状态：导入的音频 + 速度/拍号/偏移 + 鼓节奏段落 + 生成的谱面，三屏共享。
 * 段落与勾选存在这里（而非 ChartScreen 本地 state），切屏卸载后不丢失。
 * 不持久化歌曲（每次重新导入），仅设置/映射存 localStorage。
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { TaikoChart } from "@/shared/taikoChart";
import type { DrumSegment } from "./drumAnalyze";

/** 速度/拍号来源标签（谱面屏展示用） */
export type MetaSource = "metadata" | "detect" | "manual";

export interface SongState {
  audioBuffer: AudioBuffer | null;
  fileName: string;
  bpm: number;
  timeSignature: [number, number];
  /** 首拍偏移（毫秒，自动检测给出，可手动微调） */
  offsetMs: number;
  chart: TaikoChart | null;
  /** 鼓节奏分析段落（重新导入时清空） */
  segments: DrumSegment[];
  /** 勾选的段落 id */
  selectedSegmentIds: string[];
  metaSource: MetaSource | null;
}

export interface SongContextValue extends SongState {
  setSong: (patch: Partial<SongState>) => void;
}

const SongContext = createContext<SongContextValue | null>(null);

export function SongProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SongState>({
    audioBuffer: null,
    fileName: "",
    bpm: 120,
    timeSignature: [4, 4],
    offsetMs: 0,
    chart: null,
    segments: [],
    selectedSegmentIds: [],
    metaSource: null,
  });

  const value = useMemo<SongContextValue>(
    () => ({
      ...state,
      setSong: (patch) => setState((prev) => ({ ...prev, ...patch })),
    }),
    [state],
  );

  return <SongContext.Provider value={value}>{children}</SongContext.Provider>;
}

export function useSong(): SongContextValue {
  const v = useContext(SongContext);
  if (!v) throw new Error("useSong 必须在 <SongProvider> 内使用");
  return v;
}
