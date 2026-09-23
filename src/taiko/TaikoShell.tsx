import { useEffect, useState } from "react";
import { SongProvider } from "./songStore";
import { FallScreen } from "./FallScreen";
import { midiManager, installExternalBridge } from "./midiInput";
import { installStickBridge } from "./stickInput";
import { installDeviceBridge, deviceState } from "./deviceState";
import { DeviceToast } from "./DeviceToast";
import { ensureKitLoaded, loadKitEnabled, loadKitId } from "./drumKit";
import { Toaster } from "@/components/ui/sonner";
import { debugLog } from "./debugLog";

interface TaikoSettings { speed: number; midiDeviceId: string | null }
const SETTINGS_KEY = "taiko.settings.v5";
const DEFAULT_SETTINGS: TaikoSettings = { speed: 1.5, midiDeviceId: null };


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
  const [settings, setSettings] = useState<TaikoSettings>(DEFAULT_SETTINGS);
  /** null = 正式版本；"hub" = 测试主界面；其余 = 已进入的测试模式 */
  const [lab, setLab] = useState<"hub" | LabGame | null>(null);
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
  }, []);
  useEffect(() => { void midiManager.init().then(() => midiManager.select(settings.midiDeviceId)); }, [settings.midiDeviceId]);
  // 鼓声开启时后台预载当前鼓组样本，未就绪前由合成音兜底
  useEffect(() => { if (loadKitEnabled()) void ensureKitLoaded(loadKitId()); }, []);
  const updateSettings = (patch: Partial<TaikoSettings>) => setSettings((s) => {
    const next = { ...s, ...patch };
    try { const raw = localStorage.getItem(SETTINGS_KEY); const base = raw ? JSON.parse(raw) as Record<string, unknown> : {}; localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...base, ...next })); } catch { /* 仅保留内存 */ }
    return next;
  });

  return (
    <div className="taiko-root overflow-hidden bg-[var(--taiko-paper)] text-[var(--taiko-ink)]">
      <main className="relative h-full min-h-0 min-w-0 overflow-hidden">
        {lab === "rhythm" ? (
          <FallScreen
            key="lab-rhythm"
            speed={settings.speed}
            onSpeedChange={(speed) => updateSettings({ speed })}
            onExit={() => setLab("hub")}
            gestureHits
            exitLabel="↩"
          />
        ) : (
          <FallScreen
            key="release"
            speed={settings.speed}
            onSpeedChange={(speed) => updateSettings({ speed })}
            onExit={exitApp}
            onSecretUnlock={() => setLab("hub")}
          />
        )}
        {lab === "hub" && <LabHub onPick={(g) => setLab(g)} onBack={() => setLab(null)} />}
      </main>
      <DeviceToast />
      <Toaster position="top-center" />
    </div>
  );
}
