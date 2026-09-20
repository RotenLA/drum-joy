import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Language = "zh-CN" | "en";

const LANGUAGE_KEY = "taiko.language.v1";
let activeLanguage: Language = "zh-CN";

interface LanguageValue {
  language: Language;
  setLanguage: (language: Language) => void;
  /** tr(中文, English) */
  tr: (zh: string, en: string) => string;
}

const LanguageContext = createContext<LanguageValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("zh-CN");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_KEY);
      if (saved === "zh-CN" || saved === "en") setLanguageState(saved);
    } catch {
      // 存储不可用时保持默认语言
    }
  }, []);

  useEffect(() => {
    activeLanguage = language;
    document.documentElement.lang = language;
    document.title =
      language === "en" ? "PD2U AeroGame — Air Drum Studio" : "PD2U AeroGame 空气鼓游玩台";
    const description =
      language === "en"
        ? "PD2U AeroGame air drum module: full-screen falling-note play, chart setup, MIDI mapping and stick position capture."
        : "PD2U AeroGame 空气鼓模块：全屏舞台游玩、谱面设置、MIDI 映射与鼓棒位置捕捉。";
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
  }, [language]);

  const value = useMemo<LanguageValue>(
    () => ({
      language,
      setLanguage: (next) => {
        activeLanguage = next;
        setLanguageState(next);
        try {
          localStorage.setItem(LANGUAGE_KEY, next);
        } catch {
          // 存储不可用时只保留内存选择
        }
      },
      tr: (zh, en) => (language === "en" ? en : zh),
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}

/** 非 React 的桥接（日志、事件）取当前语言用 */
export function getActiveLanguage(): Language {
  return activeLanguage;
}

export function localize(language: Language, zh: string, en: string): string {
  return language === "en" ? en : zh;
}
