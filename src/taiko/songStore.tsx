/**
 * 歌曲状态：导入的音频 + 速度/拍号/偏移 + 鼓节奏段落 + 匹配到的基础节奏型
 * + 密度档位 + 生成的谱面，三屏共享。
 * 段落与选择存在这里（而非 ChartScreen 本地 state），切屏卸载后不丢失。
 * 不持久化歌曲（每次重新导入），仅密度档位存 localStorage。
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TaikoChart } from "@/shared/taikoChart";
import type { BarBands, DrumSegment } from "./drumAnalyze";
import type { Density } from "./chartSimplify";

/** 速度/拍号来源标签（谱面屏展示用） */
export type MetaSource = "metadata" | "detect" | "manual";

const SETTINGS_KEY = "taiko.settings.v2";

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
  /** 单选的主体段落 id */
  primarySegmentId: string | null;
  /** 匹配到（或手选）的基础节奏型 id */
  grooveId: string | null;
  /** 谱面密度档位 */
  density: Density;
  /** 每小节鼓声活跃度（0–1）、三类鼓件击数与稳定鼓声区间 */
  barActivity: number[];
  barBands: BarBands[];
  activeRange: [number, number] | null;
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
    primarySegmentId: null,
    grooveId: null,
    density: "normal",
    barActivity: [],
    barBands: [],
    activeRange: null,
    metaSource: null,
  });

  // hydration 后再读本地档位，避免 SSR 不一致
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { density?: unknown };
      if (parsed.density === "easy" || parsed.density === "normal" || parsed.density === "raw") {
        setState((s) => ({ ...s, density: parsed.density as Density }));
      }
    } catch {
      // 忽略损坏的本地设置
    }
  }, []);

  const value = useMemo<SongContextValue>(
    () => ({
      ...state,
      setSong: (patch) => {
        if (patch.density && patch.density !== state.density) {
          try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            const base = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
            localStorage.setItem(
              SETTINGS_KEY,
              JSON.stringify({ ...base, density: patch.density }),
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
