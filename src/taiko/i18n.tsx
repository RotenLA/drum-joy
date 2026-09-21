import { createContext, useContext, useMemo, type ReactNode } from "react";

import { debugLog } from "./debugLog";


import { dict as dictZhTW } from "./locales/zh-TW";
import { dict as dictJa } from "./locales/ja";
import { dict as dictKo } from "./locales/ko";
import { dict as dictFr } from "./locales/fr";
import { dict as dictDe } from "./locales/de";
import { dict as dictIt } from "./locales/it";
import { dict as dictEs } from "./locales/es";

/** 宿主支持的语言码；未识别的码回落 en */
export type Language = "zh-CN" | "zh-TW" | "ja" | "fr" | "ko" | "de" | "it" | "es" | "en";

/** URL ?lang= 的取值 → 内部语言码 */
const ALIASES: Record<string, Language> = {
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-tw": "zh-TW",
  "zh-hant": "zh-TW",
  "zh-hk": "zh-TW",
  ja: "ja",
  "ja-jp": "ja",
  fr: "fr",
  ko: "ko",
  de: "de",
  it: "it",
  es: "es",
  en: "en",
};

/** 各语言字典：键为简体中文原文，缺键回落英文 */
const DICTS: Partial<Record<Language, Record<string, string>>> = {
  "zh-TW": dictZhTW,
  ja: dictJa,
  ko: dictKo,
  fr: dictFr,
  de: dictDe,
  it: dictIt,
  es: dictEs,
};

/** 宿主用 URL 参数指定语言：?lang=zh / zh-TW / ja / fr / ko / de / it / es / en */
export function readLanguageFromUrl(): Language {
  if (typeof window === "undefined") return "en";
  try {
    const raw = new URLSearchParams(window.location.search).get("lang");
    if (!raw) return "en";
    return ALIASES[raw.trim().toLowerCase()] ?? "en";
  } catch {
    return "en";
  }
}

let activeLanguage: Language = "en";

interface LanguageValue {
  language: Language;
  /** tr(中文, English)：其余语言按字典查，缺词回落英文 */
  tr: (zh: string, en: string) => string;
}

const LanguageContext = createContext<LanguageValue | null>(null);

const TITLES: Partial<Record<Language, string>> = {
  "zh-CN": "PD2U AeroGame 空气鼓游玩台",
  "zh-TW": "PD2U AeroGame 空氣鼓遊玩台",
  ja: "PD2U AeroGame エアドラム",
  ko: "PD2U AeroGame 에어 드럼",
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  // 语言由宿主通过 URL 决定，运行期不切换
  const language = useMemo(() => {
    const raw =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("lang");
    const lang = readLanguageFromUrl();
    activeLanguage = lang;
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
      document.title = TITLES[lang] ?? "PD2U AeroGame — Air Drum Studio";
    }
    debugLog.push("system", `语言 ?lang=${raw ?? "(未指定)"} → ${lang}`);
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

/** 非 React 的桥接（日志、事件）取当前语言用 */
export function getActiveLanguage(): Language {
  return activeLanguage;
}

/**
 * 带变量的文案（字典键里写成 ${xxx}）在运行期已经被插值成实际文字，
 * 无法直接命中字典。这里把这类键编译成正则，按占位符名字回填。
 */
interface DynEntry {
  re: RegExp;
  names: string[];
  out: string;
}
const DYN_CACHE = new Map<Language, DynEntry[]>();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function dynEntries(language: Language): DynEntry[] {
  const cached = DYN_CACHE.get(language);
  if (cached) return cached;
  const list: DynEntry[] = [];
  const dict = DICTS[language] ?? {};
  for (const [key, value] of Object.entries(dict)) {
    if (!key.includes("${")) continue;
    const names: string[] = [];
    let pattern = "";
    let last = 0;
    for (const m of key.matchAll(/\$\{([^}]*)\}/g)) {
      pattern += escapeRe(key.slice(last, m.index));
      pattern += "(.+?)";
      names.push(m[1]!);
      last = m.index + m[0].length;
    }
    pattern += escapeRe(key.slice(last));
    list.push({ re: new RegExp(`^${pattern}$`, "s"), names, out: value });
  }
  DYN_CACHE.set(language, list);
  return list;
}

function localizeDynamic(language: Language, zh: string): string | null {
  for (const entry of dynEntries(language)) {
    const m = entry.re.exec(zh);
    if (!m) continue;
    let out = entry.out;
    entry.names.forEach((name, i) => {
      out = out.split(`\${${name}}`).join(m[i + 1] ?? "");
    });
    // 译文里占位符写法不一致时，按出现顺序兜底替换
    let i = 0;
    out = out.replace(/\$\{[^}]*\}/g, () => m[++i] ?? "");
    return out;
  }
  return null;
}

/** 语言 + 中/英原文 → 目标语言文案 */
export function localize(language: Language, zh: string, en: string): string {
  if (language === "zh-CN") return zh;
  if (language === "en") return en;
  const dict = DICTS[language];
  if (!dict) return en;
  return dict[zh] ?? localizeDynamic(language, zh) ?? en;
}
