import { useEffect, useState } from "react";
import { Crosshair, Gamepad2, ListMusic, Settings2, LogOut } from "lucide-react";
import { SongProvider, useSong } from "./songStore";
import { FallScreen } from "./FallScreen";
import { ChartScreen } from "./ChartScreen";
import { MappingScreen } from "./MappingScreen";
import { PositionCaptureScreen } from "./PositionCaptureScreen";
import { midiManager, installExternalBridge } from "./midiInput";
import { installStickBridge } from "./stickInput";
import { installDeviceBridge, deviceState, type DeviceSnapshot } from "./deviceState";
import { DeviceToast } from "./DeviceToast";
import { useLanguage } from "./i18n";
import { ensureKitLoaded, loadKitEnabled, loadKitId } from "./drumKit";
import { Toaster } from "@/components/ui/sonner";
import { debugLog } from "./debugLog";


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

/** 宿主退出接口是否已注入（未注入时不显示退出按钮） */
function hostExitAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as unknown as Record<string, unknown>)["__pd2uExit"] === "function";
}

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
  const [canExit, setCanExit] = useState(false);
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
    // Unity 可能在页面加载完成后才注入 __pd2uExit：轮询检测，注入即显示退出按钮
    let tries = 0;
    const exitTimer = setInterval(() => {
      tries += 1;
      if (hostExitAvailable()) {
        setCanExit(true);
        debugLog.push("system", "检测到宿主退出接口 __pd2uExit");
        clearInterval(exitTimer);
      } else if (tries >= 60) {
        clearInterval(exitTimer);
      }
    }, 500);
    return () => { clearInterval(exitTimer); };
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
          {canExit && (
            <button
              type="button"
              onClick={exitApp}
              aria-label={tr("退出", "Exit")}
              className="flex min-w-0 items-center gap-1.5 border border-[var(--taiko-line)] px-2 py-1 text-xs font-medium text-[var(--taiko-ink)]/80 transition-colors hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
            >
              <LogOut size={13} />
              <span className="truncate">{tr("退出", "Exit")}</span>
            </button>
          )}
          <div className="mt-1 truncate text-xs text-[var(--taiko-ink)]/55">{song.fileName || tr("未选择歌曲", "No song selected")}</div>
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
      <DeviceToast />
      <Toaster position="top-center" />
    </div>
  );
}