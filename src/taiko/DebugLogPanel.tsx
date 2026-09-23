/** 可开关的悬浮调试日志小窗（右下角） */
import { useEffect, useRef, useState } from "react";
import { debugLog, formatTime, type DebugEntry } from "./debugLog";
import { useLanguage } from "./i18n";

function intervalText(entry: DebugEntry, tr: (zh: string, en: string) => string) {
  if (entry.deltaMs === null) return tr("起点", "START");
  return `Δ ${entry.deltaMs.toFixed(1)} ms`;
}

export function DebugLogPanel() {
  const { tr } = useLanguage();
  const [open, setOpen] = useState(true);
  const [paused, setPaused] = useState(false);
  const [items, setItems] = useState<readonly DebugEntry[]>([]);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 默认开启，关闭时既不订阅也不记录。
  useEffect(() => {
    debugLog.setEnabled(open);
    return () => debugLog.setEnabled(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setItems([...debugLog.list()]);
    let raf = 0;
    const off = debugLog.subscribe(() => {
      if (paused || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setItems([...debugLog.list()]);
      });
    });
    return () => {
      off();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open, paused]);

  useEffect(() => {
    if (!open || paused) return;
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, open, paused]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute bottom-3 right-3 z-20 rounded border border-white/25 bg-black/55 px-2.5 py-1 text-[10px] tracking-[0.2em] text-white/70 backdrop-blur transition-colors hover:border-white/60 hover:text-white"
      >
        {tr("调试日志", "Debug log")}
      </button>
    );
  }

  return (
    <div className="absolute bottom-3 right-3 z-20 flex h-[46%] w-[52%] max-w-[440px] flex-col rounded border border-white/20 bg-black/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-white/15 px-2.5 py-1.5">
        <span className="text-[10px] tracking-[0.2em] text-white/70">{tr("MIDI 到达间隔", "MIDI intervals")}</span>
        <span className="text-[10px] tabular-nums text-white/35">{items.length}</span>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => setPaused((p) => !p)}
            className="border border-white/25 px-1.5 py-0.5 text-[10px] text-white/70 transition-colors hover:border-white/60 hover:text-white"
          >
            {paused ? tr("继续", "Resume") : tr("暂停", "Pause")}
          </button>
          <button
            onClick={() => debugLog.clear()}
            className="border border-white/25 px-1.5 py-0.5 text-[10px] text-white/70 transition-colors hover:border-white/60 hover:text-white"
          >
            {tr("清空", "Clear")}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="border border-white/25 px-1.5 py-0.5 text-[10px] text-white/70 transition-colors hover:border-white/60 hover:text-white"
          >
            {tr("关闭", "Close")}
          </button>
        </div>
      </div>
      <div
        ref={boxRef}
        className="flex-1 overflow-auto px-2.5 py-1.5 font-mono text-[10px] leading-relaxed"
      >
        {items.length === 0 && (
          <p className="text-white/35">
            {tr("等待 MIDI 敲击", "Waiting for MIDI note-on")}
          </p>
        )}
        {items.map((e) => {
          return (
            <div key={e.id} className="grid grid-cols-[82px_64px_56px_1fr] gap-2">
              <span className="tabular-nums text-white/30">{formatTime(e.t)}</span>
              <span className="text-cyan-200">Note {e.note}</span>
              <span className="tabular-nums text-white/55">Vel {e.velocity}</span>
              <span className="tabular-nums text-orange-300">{intervalText(e, tr)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
