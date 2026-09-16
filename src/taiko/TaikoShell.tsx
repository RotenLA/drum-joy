import { useEffect, useState } from "react";
import { Crosshair, Gamepad2, ListMusic, Settings2, Maximize } from "lucide-react";
import { SongProvider, useSong } from "./songStore";
import { FallScreen } from "./FallScreen";
import { ChartScreen } from "./ChartScreen";
import { MappingScreen } from "./MappingScreen";
import { PositionCaptureScreen } from "./PositionCaptureScreen";
import { midiManager, installExternalBridge } from "./midiInput";
import { installStickBridge } from "./stickInput";
import { FpsBadge } from "./FpsBadge";

type ScreenKey = "play" | "chart" | "mapping" | "capture";
interface TaikoSettings { speed: number; midiDeviceId: string | null }
const SETTINGS_KEY = "taiko.settings.v5";
const DEFAULT_SETTINGS: TaikoSettings = { speed: 1.5, midiDeviceId: null };
const NAV = [
  { key: "play" as const, label: "游玩", hint: "PLAY", icon: Gamepad2 },
  { key: "chart" as const, label: "谱面", hint: "CHART", icon: ListMusic },
  { key: "mapping" as const, label: "映射", hint: "MAP", icon: Settings2 },
  { key: "capture" as const, label: "位置捕捉", hint: "CAPTURE", icon: Crosshair },
];

export function TaikoShell() {
  return <SongProvider><ShellInner /></SongProvider>;
}

function ShellInner() {
  const [screen, setScreen] = useState<ScreenKey>("chart");
  const [settings, setSettings] = useState<TaikoSettings>(DEFAULT_SETTINGS);
  const song = useSong();

  useEffect(() => {
    try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) setSettings((s) => ({ ...s, ...(JSON.parse(raw) as Partial<TaikoSettings>) })); } catch { /* 忽略损坏设置 */ }
  }, []);
  useEffect(() => { installExternalBridge(); installStickBridge(); }, []);
  useEffect(() => { void midiManager.init().then(() => midiManager.select(settings.midiDeviceId)); }, [settings.midiDeviceId]);
  const updateSettings = (patch: Partial<TaikoSettings>) => setSettings((s) => {
    const next = { ...s, ...patch };
    try { const raw = localStorage.getItem(SETTINGS_KEY); const base = raw ? JSON.parse(raw) as Record<string, unknown> : {}; localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...base, ...next })); } catch { /* 仅保留内存 */ }
    return next;
  });

  return (
<div className="taiko-root relative grid grid-cols-[3fr_14fr] overflow-hidden bg-[var(--taiko-paper)] text-[var(--taiko-ink)]">
      <FpsBadge />
      <nav className="relative flex min-h-0 flex-col border-r border-[var(--taiko-line)] bg-[var(--taiko-paper)]">
        <div className="border-y border-[var(--taiko-line)] px-5 py-4">
          <div className="text-lg font-semibold text-[var(--taiko-accent)]">PD2U</div>
          <div className="mt-1 truncate text-xs text-[var(--taiko-ink)]/55">{song.fileName || "未选择歌曲"}</div>
        </div>
        <ul>
          {NAV.map((item) => { const Icon = item.icon; const active = screen === item.key; return (
            <li key={item.hint}><button onClick={() => setScreen(item.key)} className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--taiko-line)] px-5 py-4 text-left transition-colors ${active ? "bg-[var(--taiko-accent)] text-[var(--taiko-paper)]" : "hover:bg-[var(--taiko-ink)]/10"}`}><Icon size={17}/><span className="truncate text-sm">{item.label}</span><span className="text-[10px] opacity-50">{item.hint}</span></button></li>
          ); })}
        </ul>
        <button onClick={() => { const el = document.querySelector(".taiko-root"); if (!document.fullscreenElement) void el?.requestFullscreen?.(); else void document.exitFullscreen?.(); }} className="mt-auto flex items-center gap-2 border-t border-[var(--taiko-line)] px-5 py-4 text-xs text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"><Maximize size={15}/>全屏显示</button>
      </nav>

      <main className="min-h-0 min-w-0 overflow-hidden">
        {screen === "play" ? (
          <FallScreen speed={settings.speed} />
        ) : (
          <section className="flex h-full min-h-0 flex-col bg-[var(--taiko-paper)]">
            <header className="flex h-14 shrink-0 items-center border-b border-[var(--taiko-line)] px-5">
              <div className="min-w-0"><h1 className="truncate text-sm font-medium">{screen === "chart" ? "谱面" : screen === "mapping" ? "映射" : "位置捕捉"}</h1><p className="truncate text-[10px] text-[var(--taiko-ink)]/45">{song.fileName || "PD2U AeroGame"}</p></div>
            </header>
            <div key={screen} className="taiko-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">
              {screen === "chart" && <ChartScreen speed={settings.speed} onSpeedChange={(speed) => updateSettings({ speed })} />}
              {screen === "mapping" && <MappingScreen deviceId={settings.midiDeviceId} onDeviceChange={(midiDeviceId) => updateSettings({ midiDeviceId })} />}
              {screen === "capture" && <PositionCaptureScreen />}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}