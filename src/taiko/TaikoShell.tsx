import { useEffect, useMemo, useState } from "react";
import { createDemoChart } from "@/shared/taikoChart";
import { PlayScreen } from "./PlayScreen";
import { FallScreen } from "./FallScreen";
import { ChartScreen } from "./ChartScreen";
import { MappingScreen } from "./MappingScreen";
import type { LayoutMode } from "./laneLayouts";

type ScreenKey = "play" | "chart" | "mapping";
type PlayMode = "fall" | "classic";

interface TaikoSettings {
  playMode: PlayMode;
  layout: LayoutMode;
  speed: number;
}

const SETTINGS_KEY = "taiko.settings.v1";
const DEFAULT_SETTINGS: TaikoSettings = { playMode: "fall", layout: "five", speed: 1 };

const NAV: { key: ScreenKey; label: string; hint: string }[] = [
  { key: "play", label: "游玩", hint: "PLAY" },
  { key: "chart", label: "谱面", hint: "CHART" },
  { key: "mapping", label: "映射", hint: "MAP" },
];

export function TaikoShell() {
  const [screen, setScreen] = useState<ScreenKey>("play");
  const [settings, setSettings] = useState<TaikoSettings>(DEFAULT_SETTINGS);
  const chart = useMemo(() => createDemoChart(), []);

  //  hydration 后再读本地设置，避免 SSR 不一致
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) setSettings((s) => ({ ...s, ...JSON.parse(raw) }));
    } catch {
      // 忽略损坏的本地设置
    }
  }, []);

  const updateSettings = (patch: Partial<TaikoSettings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // 存储不可用时仅保留内存态
      }
      return next;
    });

  return (
    <div className="taiko-root flex min-h-screen bg-[var(--taiko-paper)] text-[var(--taiko-ink)]">
      <nav className="flex w-40 shrink-0 flex-col border-r border-[var(--taiko-line)]">
        <div className="border-b border-[var(--taiko-line)] px-4 py-5">
          <div className="text-lg font-semibold tracking-[0.3em]">太鼓</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-[var(--taiko-ink)]/45">
            LovableSynth
          </div>
        </div>
        <ul className="flex flex-col">
          {NAV.map((item) => (
            <li key={item.key}>
              <button
                onClick={() => setScreen(item.key)}
                className={`flex w-full items-baseline gap-2 border-b border-[var(--taiko-line)] px-4 py-3 text-left text-sm transition-colors ${
                  screen === item.key
                    ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                    : "hover:bg-[var(--taiko-ink)]/5"
                }`}
              >
                <span>{item.label}</span>
                <span className="text-[10px] uppercase tracking-[0.15em] opacity-50">
                  {item.hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-baseline gap-6 border-b border-[var(--taiko-line)] px-8 py-4">
          <h1 className="text-base font-medium">{chart.title}</h1>
          <span className="text-xs tabular-nums text-[var(--taiko-ink)]/55">
            BPM {chart.bpm}
          </span>
          <span className="text-xs tabular-nums text-[var(--taiko-ink)]/55">
            {chart.timeSignature[0]}/{chart.timeSignature[1]}
          </span>
          <button
            onClick={() => {
              const el = document.querySelector(".taiko-root");
              if (!document.fullscreenElement) el?.requestFullscreen?.();
              else document.exitFullscreen?.();
            }}
            className="ml-auto border border-[var(--taiko-line)] px-3 py-1 text-xs transition-colors hover:border-[var(--taiko-ink)]"
          >
            全屏
          </button>
        </header>

        <div className="flex-1 overflow-auto px-8 py-6">
          {screen === "play" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                {(
                  [
                    ["fall", "霓虹下落"],
                    ["classic", "经典横向"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => updateSettings({ playMode: mode })}
                    className={`-ml-px border border-[var(--taiko-line)] px-4 py-1.5 text-xs tracking-wide transition-colors first:ml-0 ${
                      settings.playMode === mode
                        ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                        : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="ml-auto text-xs text-[var(--taiko-ink)]/45">
                  模式 / 分区 / 速度为全局设置，自动保存
                </span>
              </div>
              {settings.playMode === "fall" ? (
                <FallScreen
                  chart={chart}
                  layout={settings.layout}
                  speed={settings.speed}
                  onLayoutChange={(layout) => updateSettings({ layout })}
                  onSpeedChange={(speed) => updateSettings({ speed })}
                />
              ) : (
                <PlayScreen chart={chart} />
              )}
            </div>
          )}
          {screen === "chart" && (
            <ChartScreen chart={chart} onSeekMeasure={() => setScreen("chart")} />
          )}
          {screen === "mapping" && <MappingScreen />}
        </div>
      </main>
    </div>
  );
}
