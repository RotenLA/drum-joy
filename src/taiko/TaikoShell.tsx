import { useEffect, useState } from "react";
import { Crosshair, Gamepad2, ListMusic, Settings2, Languages, LogOut } from "lucide-react";
import { SongProvider, useSong } from "./songStore";
import { FallScreen } from "./FallScreen";
import { ChartScreen } from "./ChartScreen";
import { MappingScreen } from "./MappingScreen";
import { PositionCaptureScreen } from "./PositionCaptureScreen";
import { midiManager, installExternalBridge } from "./midiInput";
import { installStickBridge } from "./stickInput";
import { useLanguage } from "./i18n";
import { ensureKitLoaded, loadKitEnabled, loadKitId } from "./drumKit";

type ScreenKey = "play" | "chart" | "mapping" | "capture";
interface TaikoSettings { speed: number; midiDeviceId: string | null }
const SETTINGS_KEY = "taiko.settings.v5";
const DEFAULT_SETTINGS: TaikoSettings = { speed: 1.5, midiDeviceId: null };
const NAV = [
  { key: "play" as const, zh: "游玩", en: "Play", icon: Gamepad2 },
  { key: "chart" as const, zh: "谱面", en: "Chart", icon: ListMusic },
  { key: "mapping" as const, zh: "映射", en: "Mapping", icon: Settings2 },
  { key: "capture" as const, zh: "位置捕捉", en: "Capture", icon: Crosshair },
];

function exitApp() {
  try {
    const w = window as unknown as Record<string, any>;
    if (w["vuplex"]?.postMessage) w["vuplex"].postMessage({ type: "exit" });
    if (w["Unity"]?.call) w["Unity"].call("exit");
    w["parent"]?.postMessage?.({ type: "pd2u-exit" }, "*");
  } catch { /* 忽略桥接失败 */ }
  try { window.close(); } catch { /* 忽略 */ }
}


export function TaikoShell() {
  return <SongProvider><ShellInner /></SongProvider>;
}

function ShellInner() {
  const [screen, setScreen] = useState<ScreenKey>("chart");
  const [settings, setSettings] = useState<TaikoSettings>(DEFAULT_SETTINGS);
  const song = useSong();
  const { tr, language, setLanguage } = useLanguage();

  useEffect(() => {
    try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) setSettings((s) => ({ ...s, ...(JSON.parse(raw) as Partial<TaikoSettings>) })); } catch { /* 忽略损坏设置 */ }
  }, []);
  useEffect(() => { installExternalBridge(); installStickBridge(); }, []);
  useEffect(() => { void midiManager.init().then(() => midiManager.select(settings.midiDeviceId)); }, [settings.midiDeviceId]);
  // 鼓声开启时后台预载当前鼓组样本，未就绪前由合成音兜底
  useEffect(() => { if (loadKitEnabled()) void ensureKitLoaded(loadKitId()); }, []);
  const updateSettings = (patch: Partial<TaikoSettings>) => setSettings((s) => {
    const next = { ...s, ...patch };
    try { const raw = localStorage.getItem(SETTINGS_KEY); const base = raw ? JSON.parse(raw) as Record<string, unknown> : {}; localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...base, ...next })); } catch { /* 仅保留内存 */ }
    return next;
  });

  return (
<div className="taiko-root grid grid-cols-[clamp(116px,18%,232px)_minmax(0,1fr)] overflow-hidden bg-[var(--taiko-paper)] text-[var(--taiko-ink)]">
      <nav className="relative flex min-h-0 flex-col border-r border-[var(--taiko-line)] bg-[var(--taiko-paper)]">
        <div className="border-y border-[var(--taiko-line)] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={exitApp}
              aria-label={tr("退出", "Exit")}
              className="flex min-w-0 items-center gap-1.5 border border-[var(--taiko-line)] px-2 py-1 text-xs font-medium text-[var(--taiko-ink)]/80 transition-colors hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
            >
              <LogOut size={13} />
              <span className="truncate">{tr("退出", "Exit")}</span>
            </button>

            <button
              type="button"
              onClick={() => setLanguage(language === "en" ? "zh-CN" : "en")}
              aria-label={tr("切换语言", "Switch language")}
              className="flex shrink-0 items-center gap-1 border border-[var(--taiko-line)] px-1.5 py-0.5 text-[10px] text-[var(--taiko-ink)]/70 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
            >
              <Languages size={12} />
              {language === "en" ? "EN" : "中"}
            </button>
          </div>
          <div className="mt-1 truncate text-xs text-[var(--taiko-ink)]/55">{song.fileName || tr("未选择歌曲", "No song selected")}</div>
        </div>
        <ul>
          {NAV.map((item) => { const Icon = item.icon; const active = screen === item.key; return (
            <li key={item.key}><button onClick={() => setScreen(item.key)} className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-[var(--taiko-line)] px-4 py-3.5 text-left transition-colors ${active ? "bg-[var(--taiko-accent)] text-[var(--taiko-paper)]" : "hover:bg-[var(--taiko-ink)]/10"}`}><Icon size={17}/><span className="truncate text-sm">{language === "en" ? item.en : item.zh}</span></button></li>
          ); })}
        </ul>
      </nav>

      <main className="min-h-0 min-w-0 overflow-hidden">
        {screen === "play" ? (
          <FallScreen speed={settings.speed} />
        ) : (
          <section className="flex h-full min-h-0 flex-col bg-[var(--taiko-paper)]">
            <header className="flex h-12 shrink-0 items-center border-b border-[var(--taiko-line)] px-5">
              <div className="min-w-0"><h1 className="truncate text-sm font-medium">{screen === "chart" ? tr("谱面", "Chart") : screen === "mapping" ? tr("映射", "Mapping") : tr("位置捕捉", "Position Capture")}</h1><p className="truncate text-[10px] text-[var(--taiko-ink)]/45">{song.fileName || "PD2U AeroGame"}</p></div>
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