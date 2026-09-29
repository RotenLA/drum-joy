import { createContext, useContext, useMemo, type Context, type ReactNode } from "react";

import { debugLog } from "./debugLog";

/** 只保留两种语言：?lang=zh* → 简体中文，其余（含未指定）→ 英文 */
export type Language = "zh-CN" | "en";

export function readLanguageFromUrl(): Language {
  if (typeof window === "undefined") return "en";
  try {
    const raw = new URLSearchParams(window.location.search).get("lang");
    return raw && raw.trim().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  } catch {
    return "en";
  }
}

let activeLanguage: Language = "en";

interface LanguageValue {
  language: Language;
  tr: (zh: string, en: string) => string;
}

const ctxHolder = globalThis as unknown as {
  __pd2uLangCtx?: Context<LanguageValue | null>;
};
const LanguageContext =
  ctxHolder.__pd2uLangCtx ??
  (ctxHolder.__pd2uLangCtx = createContext<LanguageValue | null>(null));

export function LanguageProvider({ children }: { children: ReactNode }) {
  const language = useMemo(() => {
    const lang = readLanguageFromUrl();
    activeLanguage = lang;
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
      document.title = lang === "zh-CN" ? "PD2U AeroGame 空气鼓游玩台" : "PD2U AeroGame — Air Drum Studio";
    }
    debugLog.push("system", `lang → ${lang}`);
    return lang;
  }, []);

  const value = useMemo<LanguageValue>(
    () => ({ language, tr: (zh, en) => localize(language, zh, en) }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}

export function getActiveLanguage(): Language {
  return activeLanguage;
}

export function localize(language: Language, zh: string, en: string): string {
  return language === "zh-CN" ? zh : en;
}
