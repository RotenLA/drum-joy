import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/taiko/i18n";

/**
 * 参数旁的圆形「?」：点击弹出一段说明（跟随界面语言），点击外部或再次点击关闭。
 */
export function HelpDot({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement | null>(null);
  const { tr } = useLanguage();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <span ref={boxRef} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label ? `${label} ${tr("说明", "help")}` : tr("说明", "Help")}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] leading-none transition-colors ${
          open
            ? "border-[var(--taiko-accent)] text-[var(--taiko-accent)]"
            : "border-[var(--taiko-ink)]/40 text-[var(--taiko-ink)]/50 hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
        }`}
      >
        ?
      </button>
      {open && (
        <span className="absolute left-1/2 top-6 z-30 w-64 -translate-x-1/2 border border-[var(--taiko-line)] bg-[var(--taiko-surface)] px-3 py-2 text-[11px] leading-relaxed text-[var(--taiko-ink)]/80 shadow-lg">
          {label && <span className="mb-1 block font-medium text-[var(--taiko-ink)]">{label}</span>}
          {text}
        </span>
      )}
    </span>
  );
}
