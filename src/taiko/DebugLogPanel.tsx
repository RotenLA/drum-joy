/** 可开关的悬浮调试日志小窗（右下角） */
import { useEffect, useRef, useState } from "react";
import { debugLog, formatTime, type DebugEntry } from "./debugLog";
import { useLanguage } from "./i18n";

function kindStyle(kind: DebugEntry["kind"], tr: (zh: string, en: string) => string) {
  const table: Record<DebugEntry["kind"], { label: string; color: string }> = {
    midi: { label: "MIDI", color: "#7DE2FF" },
    inject: { label: tr("注入", "Inject"), color: "#FFC46B" },
    stick: { label: tr("鼓棒", "Stick"), color: "#95F96F" },
    system: { label: tr("系统", "System"), color: "#B39CFF" },
  };
  return table[kind];
}

export function DebugLogPanel() {
  const { tr } = useLanguage();
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [items, setItems] = useState<readonly DebugEntry[]>([]);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 关闭时既不订阅也不记录，零开销
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
        <span className="text-[10px] tracking-[0.2em] text-white/70">{tr("调试日志", "Debug log")}</span>
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
            {tr("暂无消息（等待 MIDI 或鼓棒数据）", "No messages yet (waiting for MIDI or stick data)")}
          </p>
        )}
        {items.map((e) => {
          const k = kindStyle(e.kind, tr);
          return (
            <div key={e.id} className="flex gap-2">
              <span className="tabular-nums text-white/30">{formatTime(e.t)}</span>
              <span style={{ color: k.color }}>{k.label}</span>
              <span className="min-w-0 flex-1 break-all text-white/75">{e.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
