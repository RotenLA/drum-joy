/**
 * 歌曲状态：多轨 stem 音频（Vocals / Bass / Drums / Other）+ 对应鼓 MIDI（同主文件名配对）
 * + 难度 + 生成的谱面。速度/拍号只来自 MIDI 的 tempo / time signature map。
 * 不持久化歌曲（每次重新导入），仅难度与调音台音量存 localStorage。
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Context,
  type ReactNode,
} from "react";
import type { TaikoChart } from "@/shared/taikoChart";
import type { ParsedMidi } from "./midiFile";
import type { Difficulty } from "./difficulty";
import { STEM_KINDS, emptyStems, type StemKind, type StemMap } from "./stems";

const SETTINGS_KEY = "taiko.settings.v4";

/** 四轨调音台音量，0~1，1 = 原始文件音量 */
export interface MixState {
  vocals: number;
  drums: number;
  bass: number;
  other: number;
}

export const DEFAULT_MIX: MixState = { vocals: 1, drums: 0, bass: 1, other: 1 };

export interface SongState {
  /** 各条 stem 音轨（可缺，全缺则静音试玩） */
  stems: StemMap;
  /** 配对用的主文件名（不含扩展名与 stem 后缀） */
  fileName: string;
  midiFileName: string;
  midi: ParsedMidi | null;
  /** MIDI 与音频对齐的整体偏移（毫秒，可手动微调） */
  offsetMs: number;
  /** 小节相位手动微调（拍，自动检测之上的偏移） */
  phaseBeatOffset: number;
  bpm: number;
  timeSignature: [number, number];
  difficulty: Difficulty;
  mix: MixState;
  chart: TaikoChart | null;
}

export interface SongContextValue extends SongState {
  setSong: (patch: Partial<SongState>) => void;
}

/**
 * Vite 热更新可能只替换 useSong 所在模块，留下仍挂载着旧 Context 的 Provider。
 * 将 Context 缓存在 globalThis，确保热更新前后的 Provider / consumer 使用同一实例。
 */
const songContextGlobal = globalThis as typeof globalThis & {
  __lovableSynthSongContext?: Context<SongContextValue | null>;
};

const SongContext =
  songContextGlobal.__lovableSynthSongContext ?? createContext<SongContextValue | null>(null);

songContextGlobal.__lovableSynthSongContext = SongContext;

const clamp01 = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

export function SongProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SongState>({
    stems: emptyStems(),
    fileName: "",
    midiFileName: "",
    midi: null,
    offsetMs: 0,
    phaseBeatOffset: 0,
    bpm: 120,
    timeSignature: [4, 4],
    difficulty: "standard",
    mix: { ...DEFAULT_MIX },
    chart: null,
  });

  // hydration 后再读本地设置，避免 SSR 不一致
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const d = parsed["difficulty"];
      const mix = parsed["mix"] as Record<string, unknown> | undefined;
      setState((s) => ({
        ...s,
        difficulty: d === "beginner" || d === "standard" || d === "hard" ? d : s.difficulty,
        mix: mix
          ? (Object.fromEntries(
              STEM_KINDS.map((k) => [k, clamp01(mix[k], DEFAULT_MIX[k])]),
            ) as MixState)
          : s.mix,
      }));
    } catch {
      // 忽略损坏的本地设置
    }
  }, []);

  const value = useMemo<SongContextValue>(
    () => ({
      ...state,
      setSong: (patch) => {
        if (patch.difficulty !== undefined || patch.mix !== undefined) {
          try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            const base = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
            const next = { ...base };
            if (patch.difficulty !== undefined) next["difficulty"] = patch.difficulty;
            if (patch.mix !== undefined) next["mix"] = patch.mix;
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
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
