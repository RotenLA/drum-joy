/**
 * 歌曲状态：去鼓伴奏音频 + 对应鼓 MIDI（同文件名配对）+ 难度 + 生成的谱面。
 * 速度/拍号只来自 MIDI 的 tempo / time signature map。
 * 不持久化歌曲（每次重新导入），仅难度存 localStorage。
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TaikoChart } from "@/shared/taikoChart";
import type { ParsedMidi } from "./midiFile";
import type { Difficulty } from "./difficulty";

const SETTINGS_KEY = "taiko.settings.v3";

export interface SongState {
  /** 去掉鼓声的伴奏音频（可为空，仅 MIDI 时静音试玩） */
  audioBuffer: AudioBuffer | null;
  /** 配对用的主文件名（不含扩展名） */
  fileName: string;
  audioFileName: string;
  midiFileName: string;
  midi: ParsedMidi | null;
  /** MIDI 与音频对齐的整体偏移（毫秒，可手动微调） */
  offsetMs: number;
  bpm: number;
  timeSignature: [number, number];
  difficulty: Difficulty;
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
    audioFileName: "",
    midiFileName: "",
    midi: null,
    offsetMs: 0,
    bpm: 120,
    timeSignature: [4, 4],
    difficulty: "standard",
    chart: null,
  });

  // hydration 后再读本地设置，避免 SSR 不一致
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const d = parsed["difficulty"];
      if (d === "beginner" || d === "standard" || d === "hard") {
        setState((s) => ({ ...s, difficulty: d }));
      }
    } catch {
      // 忽略损坏的本地设置
    }
  }, []);

  const value = useMemo<SongContextValue>(
    () => ({
      ...state,
      setSong: (patch) => {
        if (patch.difficulty !== undefined) {
          try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            const base = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
            localStorage.setItem(
              SETTINGS_KEY,
              JSON.stringify({ ...base, difficulty: patch.difficulty }),
            );
          } catch {
            // 存储不可用时仅保留内存态
          }
        }
        setState((prev) => ({ ...prev, ...patch }));
      },
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
