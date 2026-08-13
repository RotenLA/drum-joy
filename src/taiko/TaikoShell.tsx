import { useMemo, useState } from "react";
import { createDemoChart } from "@/shared/taikoChart";
import { PlayScreen } from "./PlayScreen";
import { ChartScreen } from "./ChartScreen";
import { MappingScreen } from "./MappingScreen";

type ScreenKey = "play" | "chart" | "mapping";

const NAV: { key: ScreenKey; label: string; hint: string }[] = [
  { key: "play", label: "游玩", hint: "PLAY" },
  { key: "chart", label: "谱面", hint: "CHART" },
  { key: "mapping", label: "映射", hint: "MAP" },
];

export function TaikoShell() {
  const [screen, setScreen] = useState<ScreenKey>("play");
  const chart = useMemo(() => createDemoChart(), []);

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
          {screen === "play" && <PlayScreen chart={chart} />}
          {screen === "chart" && (
            <ChartScreen chart={chart} onSeekMeasure={() => setScreen("chart")} />
          )}
          {screen === "mapping" && <MappingScreen />}
        </div>
      </main>
    </div>
  );
}
