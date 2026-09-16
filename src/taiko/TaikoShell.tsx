import { useEffect, useState } from "react";
import { Crosshair, Gamepad2, ListMusic, Menu, Settings2, X, Maximize } from "lucide-react";
import { SongProvider, useSong } from "./songStore";
import { FallScreen } from "./FallScreen";
import { ChartScreen } from "./ChartScreen";
import { MappingScreen } from "./MappingScreen";
import { PositionCaptureScreen } from "./PositionCaptureScreen";
import { midiManager, installExternalBridge } from "./midiInput";
import { installStickBridge } from "./stickInput";

type PanelKey = "chart" | "mapping" | "capture" | null;
interface TaikoSettings { speed: number; midiDeviceId: string | null }
const SETTINGS_KEY = "taiko.settings.v5";
const DEFAULT_SETTINGS: TaikoSettings = { speed: 1.5, midiDeviceId: null };
const NAV = [
  { key: null, label: "游玩", hint: "PLAY", icon: Gamepad2 },
  { key: "chart" as const, label: "谱面", hint: "CHART", icon: ListMusic },
  { key: "mapping" as const, label: "映射", hint: "MAP", icon: Settings2 },
  { key: "capture" as const, label: "位置捕捉", hint: "CAPTURE", icon: Crosshair },
];

export function TaikoShell() {
  return <SongProvider><ShellInner /></SongProvider>;
}

function ShellInner() {
  const [panel, setPanel] = useState<PanelKey>("chart");
  const [drawer, setDrawer] = useState(false);
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
  const open = (key: PanelKey) => { setPanel(key); setDrawer(false); };

  return (
    <div className="taiko-root relative h-dvh min-h-[320px] overflow-hidden bg-[var(--taiko-paper)] text-[var(--taiko-ink)]">
      <div className="absolute inset-0 z-0"><FallScreen speed={settings.speed} suspended={panel !== null} /></div>

      <button aria-label={drawer ? "关闭菜单" : "打开菜单"} title={drawer ? "关闭菜单" : "打开菜单"} onClick={() => setDrawer((v) => !v)} className="taiko-menu-trigger absolute z-50 grid h-11 w-11 shrink-0 place-items-center border border-[var(--taiko-line)] bg-[var(--taiko-surface)]/95 text-[var(--taiko-ink)] shadow-lg backdrop-blur transition-colors hover:border-[var(--taiko-ink)]">
        {drawer ? <X size={20} /> : <Menu size={20} />}
      </button>

      {drawer && <button aria-label="关闭菜单遮罩" onClick={() => setDrawer(false)} className="absolute inset-0 z-30 bg-black/45" />}
      <nav className={`taiko-drawer absolute inset-y-0 left-0 z-40 w-64 max-w-[82vw] border-r border-[var(--taiko-line)] bg-[var(--taiko-paper)]/95 pt-20 shadow-2xl backdrop-blur transition-transform duration-200 ${drawer ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="border-y border-[var(--taiko-line)] px-5 py-4">
          <div className="text-lg font-semibold text-[var(--taiko-accent)]">PD2U</div>
          <div className="mt-1 truncate text-xs text-[var(--taiko-ink)]/55">{song.fileName || "未选择歌曲"}</div>
        </div>
        <ul>
          {NAV.map((item) => { const Icon = item.icon; const active = panel === item.key; return (
            <li key={item.hint}><button onClick={() => open(item.key)} className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--taiko-line)] px-5 py-4 text-left ${active ? "bg-[var(--taiko-accent)] text-[var(--taiko-paper)]" : "hover:bg-[var(--taiko-ink)]/10"}`}><Icon size={17}/><span className="truncate text-sm">{item.label}</span><span className="text-[10px] opacity-50">{item.hint}</span></button></li>
          ); })}
        </ul>
        <button onClick={() => { const el = document.querySelector(".taiko-root"); if (!document.fullscreenElement) void el?.requestFullscreen?.(); else void document.exitFullscreen?.(); setDrawer(false); }} className="absolute bottom-5 left-5 flex items-center gap-2 text-xs text-[var(--taiko-ink)]/60"><Maximize size={15}/>全屏显示</button>
      </nav>

      {panel && (
        <section className="taiko-panel absolute z-20 overflow-hidden border border-[var(--taiko-line)] bg-[var(--taiko-paper)]/96 shadow-2xl backdrop-blur">
          <header className="grid h-14 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-[var(--taiko-line)] px-3 pl-16 md:px-4 md:pl-16">
            <div className="min-w-0"><h1 className="truncate text-sm font-medium">{panel === "chart" ? "谱面" : panel === "mapping" ? "映射" : "位置捕捉"}</h1><p className="truncate text-[10px] text-[var(--taiko-ink)]/45">{song.fileName || "PD2U AeroGame"}</p></div>
            <button aria-label="关闭窗口" title="关闭" onClick={() => setPanel(null)} className="grid h-9 w-9 shrink-0 place-items-center border border-[var(--taiko-line)] hover:border-[var(--taiko-ink)]"><X size={17}/></button>
          </header>
          <div className="h-[calc(100%-3.5rem)] overflow-auto p-4 md:p-6">
            {panel === "chart" && <ChartScreen speed={settings.speed} onSpeedChange={(speed) => updateSettings({ speed })} />}
            {panel === "mapping" && <MappingScreen deviceId={settings.midiDeviceId} onDeviceChange={(midiDeviceId) => updateSettings({ midiDeviceId })} />}
            {panel === "capture" && <PositionCaptureScreen />}
          </div>
        </section>
      )}
    </div>
  );
}