import { useEffect, useState } from "react";
import { Gamepad2, ListMusic, LogOut } from "lucide-react";
import { SongProvider, useSong } from "./songStore";
import { FallScreen } from "./FallScreen";
import { ChartScreen } from "./ChartScreen";
import { midiManager, installExternalBridge } from "./midiInput";
import { installStickBridge } from "./stickInput";
import { installDeviceBridge, deviceState, type DeviceSnapshot } from "./deviceState";
import { DeviceToast } from "./DeviceToast";
import { useLanguage } from "./i18n";
import { ensureKitLoaded, loadKitEnabled, loadKitId } from "./drumKit";
import { Toaster } from "@/components/ui/sonner";
import { debugLog } from "./debugLog";


type ScreenKey = "play" | "chart";
interface TaikoSettings { speed: number; midiDeviceId: string | null }
const SETTINGS_KEY = "taiko.settings.v5";
const DEFAULT_SETTINGS: TaikoSettings = { speed: 1.5, midiDeviceId: null };
const NAV = [
  { key: "play" as const, zh: "游玩", en: "Play", icon: Gamepad2 },
  { key: "chart" as const, zh: "谱面设置", en: "Chart settings", icon: ListMusic },
];


/** 关闭面板回宿主大厅：只走 window.__pd2uExit()，幂等；300ms 内去重（开发环境可能双触发） */
let lastExitAt = 0;
function exitApp(): void {
  try {
    const now = Date.now();
    if (now - lastExitAt < 300) return;
    lastExitAt = now;
    const fn = (window as unknown as { __pd2uExit?: () => void }).__pd2uExit;
    if (typeof fn !== "function") {
      debugLog.push("system", "__pd2uExit 尚未注入，本次点击忽略");
      return;
    }
    debugLog.push("system", "调用 window.__pd2uExit()");
    fn();
  } catch {
    // 宿主未就绪时忽略
  }
}




export function TaikoShell() {
  return <SongProvider><ShellInner /></SongProvider>;
}

function ShellInner() {
  const [screen, setScreen] = useState<ScreenKey>("chart");
  const [settings, setSettings] = useState<TaikoSettings>(DEFAULT_SETTINGS);
  const [devices, setDevices] = useState<DeviceSnapshot | null>(null);
  const song = useSong();
  const { tr } = useLanguage();

  useEffect(() => {
    try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) setSettings((s) => ({ ...s, ...(JSON.parse(raw) as Partial<TaikoSettings>) })); } catch { /* 忽略损坏设置 */ }
  }, []);
  useEffect(() => {
    installExternalBridge();
    installStickBridge();
    installDeviceBridge();
    // mount 后必查一次：初始状态的唯一来源
    deviceState.query();
    if (deviceState.available) setDevices(deviceState.state);
  }, []);
  useEffect(() => deviceState.subscribe((s) => setDevices(s)), []);
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
          <button
            type="button"
            onClick={exitApp}
            aria-label={tr("退出", "Exit")}
            className="flex min-w-0 items-center gap-1.5 border border-[var(--taiko-line)] px-2 py-1 text-xs font-medium text-[var(--taiko-ink)]/80 transition-colors hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
          >
            <LogOut size={13} />
            <span className="truncate">{tr("退出", "Exit")}</span>
          </button>
          {devices && (
            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-[var(--taiko-ink)]/60">
              {([
                ["m", tr("适配器", "Adapter"), devices.m],
                ["l", tr("左鼓棒", "Left stick"), devices.l],
                ["r", tr("右鼓棒", "Right stick"), devices.r],
                ["f", tr("踏板", "Pedal"), devices.f],
              ] as const).map(([key, label, on]) => (
                <span key={key} className="flex items-center gap-1">
                  <i
                    className={`inline-block h-1.5 w-1.5 rounded-full ${on ? "bg-[var(--taiko-accent)]" : "bg-[var(--taiko-ink)]/25"}`}
                  />
                  <span className={on ? "" : "opacity-60"}>{label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <ul>
          {NAV.map((item) => { const Icon = item.icon; const active = screen === item.key; return (
            <li key={item.key}><button onClick={() => setScreen(item.key)} className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-[var(--taiko-line)] px-4 py-3.5 text-left transition-colors ${active ? "bg-[var(--taiko-accent)] text-[var(--taiko-paper)]" : "hover:bg-[var(--taiko-ink)]/10"}`}><Icon size={17}/><span className="truncate text-sm">{tr(item.zh, item.en)}</span></button></li>
          ); })}
        </ul>
      </nav>

      <main className="min-h-0 min-w-0 overflow-hidden">
        {screen === "play" ? (
          <FallScreen speed={settings.speed} onSpeedChange={(speed) => updateSettings({ speed })} />
        ) : (
          <section className="flex h-full min-h-0 flex-col bg-[var(--taiko-paper)]">
            <header className="flex h-12 shrink-0 items-center border-b border-[var(--taiko-line)] px-5">
              <div className="min-w-0"><h1 className="truncate text-sm font-medium">{tr("谱面设置", "Chart settings")}</h1><p className="truncate text-[10px] text-[var(--taiko-ink)]/45">{song.fileName || "PD2U AeroGame"}</p></div>
            </header>
            <div className="taiko-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">
              <ChartScreen speed={settings.speed} onSpeedChange={(speed) => updateSettings({ speed })} />
            </div>

          </section>
        )}
      </main>
      <DeviceToast />
      <Toaster position="top-center" />
    </div>
  );
}