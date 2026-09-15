import { useEffect, useState } from "react";
import { SongProvider, useSong } from "./songStore";
import { FallScreen } from "./FallScreen";
import { ChartScreen } from "./ChartScreen";
import { MappingScreen } from "./MappingScreen";
import { midiManager, installExternalBridge } from "./midiInput";
import { installStickBridge } from "./stickInput";

type ScreenKey = "play" | "chart" | "mapping";

interface TaikoSettings {
  speed: number;
  midiDeviceId: string | null;
}

const SETTINGS_KEY = "taiko.settings.v5";
const DEFAULT_SETTINGS: TaikoSettings = {
  speed: 1.5,
  midiDeviceId: null,
};

const NAV: { key: ScreenKey; label: string; hint: string }[] = [
  { key: "play", label: "游玩", hint: "PLAY" },
  { key: "chart", label: "谱面", hint: "CHART" },
  { key: "mapping", label: "映射", hint: "MAP" },
];

export function TaikoShell() {
  return (
    <SongProvider>
      <ShellInner />
    </SongProvider>
  );
}

function ShellInner() {
  const [screen, setScreen] = useState<ScreenKey>("play");
  const [settings, setSettings] = useState<TaikoSettings>(DEFAULT_SETTINGS);
  const song = useSong();

  // hydration 后再读本地设置，避免 SSR 不一致
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<TaikoSettings>;
      setSettings((s) => ({ ...s, ...parsed }));
    } catch {
      // 忽略损坏的本地设置
    }
  }, []);

  // 暴露 __pd2uNoteOn/__pd2uNoteOff 给 Unity 等宿主注入 MIDI 事件
  useEffect(() => {
    installExternalBridge();
    installStickBridge();
  }, []);

  // MIDI 初始化 + 应用已保存的输入设备
  useEffect(() => {
    void midiManager.init().then(() => midiManager.select(settings.midiDeviceId));
  }, [settings.midiDeviceId]);

  const updateSettings = (patch: Partial<TaikoSettings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        const base = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...base, ...next }));
      } catch {
        // 存储不可用时仅保留内存态
      }
      return next;
    });

  return (
    <div className="taiko-root flex min-h-screen bg-[var(--taiko-paper)] text-[var(--taiko-ink)]">
      <nav className="flex w-40 shrink-0 flex-col border-r border-[var(--taiko-line)]">
        <div className="border-b border-[var(--taiko-line)] px-4 py-5">
          <div className="text-lg font-semibold tracking-[0.3em] text-[var(--taiko-accent)]">
            PD2U
          </div>
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
                    ? "bg-[var(--taiko-accent)] text-[var(--taiko-paper)]"
                    : "hover:bg-[var(--taiko-ink)]/10"
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
          <h1 className="text-base font-medium">{song.fileName || "未导入歌曲"}</h1>
          {song.midi && (
            <>
              <span className="text-xs tabular-nums text-[var(--taiko-ink)]/55">
                BPM {song.bpm}
              </span>
              <span className="text-xs tabular-nums text-[var(--taiko-ink)]/55">
                {song.timeSignature[0]}/{song.timeSignature[1]}
              </span>
              <span className="text-xs tabular-nums text-[var(--taiko-ink)]/55">
                {song.chart ? `${song.chart.notes.length} 音符` : "谱面未生成"}
              </span>
            </>
          )}
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
          {screen === "play" && <FallScreen speed={settings.speed} />}

          {screen === "chart" && (
            <ChartScreen
              speed={settings.speed}
              onSpeedChange={(speed) => updateSettings({ speed })}
            />
          )}
          {screen === "mapping" && (
            <MappingScreen
              deviceId={settings.midiDeviceId}
              onDeviceChange={(midiDeviceId) => updateSettings({ midiDeviceId })}
            />
          )}
        </div>
      </main>

      {tutorial && (
        <TutorialOverlay
          onFinish={() => {
            setTutorial(false);
            setScreen("chart");
          }}
        />
      )}

    </div>
  );
}
