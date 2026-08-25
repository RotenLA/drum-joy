/**
 * 歌曲状态：导入的音频 + 速度/拍号/偏移 + 歌曲段落分析 + 自定义节奏
 * + 谱面难度（密度档位）与倾向风格 + 生成的谱面，三屏共享。
 * 段落与选择存在这里（而非 ChartScreen 本地 state），切屏卸载后不丢失。
 * 不持久化歌曲（每次重新导入），仅难度/风格/自定义节奏存 localStorage。
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TaikoChart } from "@/shared/taikoChart";
import type { BarBands, DrumSegment } from "./drumAnalyze";
import type { Density } from "./chartSimplify";
import { emptyCustom, type CustomPattern } from "./groovePatterns";
import { DEFAULT_STYLE, isStyleId, type StyleId } from "./grooveStyles";

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
  /** 歌曲段落分析结果（重新导入时清空） */
  segments: DrumSegment[];
  /** 单选的主体段落 id */
  primarySegmentId: string | null;
  /** 后台匹配到的基础节奏型 id */
  grooveId: string | null;
  /** 是否以「自定义节奏」为骨架（与段落单选互斥） */
  useCustom: boolean;
  /** 自定义一小节（三轨 16 分位图） */
  customPattern: CustomPattern;
  /** 谱面难度（密度档位） */
  density: Density;
  /** 倾向风格 */
  style: StyleId;
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

const PERSIST_KEYS = ["density", "style", "useCustom", "customPattern"] as const;

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
    useCustom: false,
    customPattern: emptyCustom(4),
    density: "normal",
    style: DEFAULT_STYLE,
    barActivity: [],
    barBands: [],
    activeRange: null,
    metaSource: null,
  });

  // hydration 后再读本地设置，避免 SSR 不一致
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const patch: Partial<SongState> = {};
      if (parsed.density === "easy" || parsed.density === "normal" || parsed.density === "raw") {
        patch.density = parsed.density as Density;
      }
      if (isStyleId(parsed.style)) patch.style = parsed.style;
      if (typeof parsed.useCustom === "boolean") patch.useCustom = parsed.useCustom;
      const cp = parsed.customPattern as Partial<CustomPattern> | undefined;
      if (cp && Array.isArray(cp.kick) && Array.isArray(cp.snare) && Array.isArray(cp.hihat)) {
        patch.customPattern = {
          kick: cp.kick.map(Boolean),
          snare: cp.snare.map(Boolean),
          hihat: cp.hihat.map(Boolean),
        };
      }
      if (Object.keys(patch).length > 0) setState((s) => ({ ...s, ...patch }));
    } catch {
      // 忽略损坏的本地设置
    }
  }, []);

  const value = useMemo<SongContextValue>(
    () => ({
      ...state,
      setSong: (patch) => {
        if (PERSIST_KEYS.some((k) => patch[k] !== undefined)) {
          try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            const base = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
            const next = { ...state, ...patch };
            localStorage.setItem(
              SETTINGS_KEY,
              JSON.stringify({
                ...base,
                density: next.density,
                style: next.style,
                useCustom: next.useCustom,
                customPattern: next.customPattern,
              }),
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
