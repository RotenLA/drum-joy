/**
 * 歌曲状态：导入的音频 + 速度/拍号/偏移 + 生成的谱面，三屏共享。
 * 不持久化歌曲（每次重新导入），仅设置/映射存 localStorage。
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { TaikoChart } from "@/shared/taikoChart";

export interface SongState {
  audioBuffer: AudioBuffer | null;
  fileName: string;
  bpm: number;
  timeSignature: [number, number];
  /** 首拍偏移（毫秒，自动检测给出，可手动微调） */
  offsetMs: number;
  chart: TaikoChart | null;
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
