import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TaikoShell } from "@/taiko/TaikoShell";
import { LanguageProvider } from "@/taiko/i18n";
import { compatibilityResult, engineVersion } from "@/taiko/platform";
import { Button } from "@/components/ui/button";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PD2U AeroGame 空气鼓游玩台" },
      {
        name: "description",
        content:
          "PD2U AeroGame 空气鼓模块：全屏舞台选歌、全局谱面设置与 MIDI 空气鼓演奏。",
      },
      { property: "og:title", content: "PD2U AeroGame 空气鼓游玩台" },
      {
        property: "og:description",
        content: "全屏空气鼓选歌、全局谱面设置与 MIDI 演奏的一体化界面。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  // 语言与本地设置只有在浏览器里才知道，预渲染阶段先留空，
  // 挂载后再一次性渲染真实界面，避免首屏文字与预渲染内容不一致的警告。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div style={{ minHeight: "100vh", background: "#100c0a" }} />;

  if (!compatibilityResult().supported || document.documentElement.hasAttribute("data-pd2u-unsupported")) {
    return <UnsupportedBrowser engine={engineVersion()} />;
  }

  return (
    <LanguageProvider>
      <TaikoShell />
    </LanguageProvider>
  );
}

const UPGRADE_COPY: Record<string, { title: string; body: string; exit: string }> = {
  "zh-CN": { title: "系统浏览器组件版本过低", body: "请升级 Android System WebView、Chrome 或系统后重试。", exit: "退出" },
  "zh-TW": { title: "系統瀏覽器元件版本過低", body: "請升級 Android System WebView、Chrome 或系統後重試。", exit: "退出" },
  en: { title: "System browser component is too old", body: "Update Android System WebView, Chrome, or your system, then try again.", exit: "Exit" },
  ja: { title: "システムのブラウザ部品が古すぎます", body: "Android System WebView、Chrome、またはシステムを更新してください。", exit: "終了" },
  ko: { title: "시스템 브라우저 구성 요소가 너무 오래되었습니다", body: "Android System WebView, Chrome 또는 시스템을 업데이트한 후 다시 시도하세요.", exit: "종료" },
  fr: { title: "Le composant navigateur est trop ancien", body: "Mettez à jour Android System WebView, Chrome ou le système, puis réessayez.", exit: "Quitter" },
  de: { title: "Die Browser-Komponente ist zu alt", body: "Aktualisieren Sie Android System WebView, Chrome oder das System und versuchen Sie es erneut.", exit: "Beenden" },
  it: { title: "Il componente browser è troppo vecchio", body: "Aggiorna Android System WebView, Chrome o il sistema, poi riprova.", exit: "Esci" },
  es: { title: "El componente del navegador es demasiado antiguo", body: "Actualiza Android System WebView, Chrome o el sistema y vuelve a intentarlo.", exit: "Salir" },
};

function UnsupportedBrowser({ engine }: { engine: number }) {
  const raw = new URLSearchParams(window.location.search).get("lang")?.toLowerCase() ?? "zh-cn";
  const key = raw === "zh" || raw.startsWith("zh-cn") || raw.startsWith("zh-hans") ? "zh-CN" : raw.startsWith("zh-tw") || raw.startsWith("zh-hant") || raw.startsWith("zh-hk") ? "zh-TW" : raw.split("-")[0] ?? "zh-CN";
  const copy = UPGRADE_COPY[key] ?? UPGRADE_COPY["en"] ?? {
    title: "System browser component is too old",
    body: "Please update your system browser component and try again.",
    exit: "Exit",
  };
  return <main className="flex min-h-screen items-center justify-center bg-[var(--taiko-paper)] p-6 text-[var(--taiko-ink)]"><section className="w-full max-w-lg rounded-lg border border-[var(--taiko-glass-line)] bg-[var(--taiko-glass-strong)] p-7 text-center"><h1 className="text-xl font-semibold">{copy.title}</h1><p className="mt-3 text-sm leading-7 text-[rgba(255,255,255,0.7)]">{copy.body}</p>{engine > 0 && <p className="mt-2 text-xs text-[rgba(255,255,255,0.44)]">WebView / Chrome {engine}</p>}<Button className="mt-6 bg-[var(--taiko-accent)] text-[var(--taiko-paper)]" onClick={() => { const fn = (window as unknown as { __pd2uExit?: () => void }).__pd2uExit; if (typeof fn === "function") fn(); }}>{copy.exit}</Button></section></main>;
}

