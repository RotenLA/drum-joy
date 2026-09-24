/**
 * 选中歌曲卡片内的操作区：难度（带最佳成绩/进度）+ 鼓音色开关 + 鼓组。
 * 与设置弹窗共用同一份全局值。
 */
import { useEffect, useState } from "react";
import { DIFFICULTIES } from "./difficulty";
import {
  KIT_NAMES,
  ensureKitLoaded,
  loadKitEnabled,
  loadKitId,
  saveKitEnabled,
  saveKitId,
  subscribeKitEnabled,
  subscribeKitId,
} from "./drumKit";
import { useSong } from "./songStore";
import { useLanguage } from "./i18n";
import type { BestMap } from "./history";

export function CardControls({ songId, bests }: { songId: string; bests: BestMap }) {
  const song = useSong();
  const { tr } = useLanguage();
  const [kitOn, setKitOn] = useState(true);
  const [kitId, setKitId] = useState(0);
  useEffect(() => {
    setKitOn(loadKitEnabled());
    setKitId(loadKitId());
    const a = subscribeKitEnabled(setKitOn);
    const b = subscribeKitId(setKitId);
    return () => {
      a();
      b();
    };
  }, []);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="flex flex-col gap-2 sm:gap-3"
      onClick={stop}
      onPointerDown={stop}
    >
      <div className="grid grid-cols-4 gap-1.5">
        {DIFFICULTIES.map((d) => {
          const b = bests[`${songId}|${d.id}`];
          const on = song.difficulty === d.id;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => song.setSong({ difficulty: d.id })}
              className={`flex min-w-0 flex-col items-stretch gap-0.5 rounded-md border px-1.5 py-1 text-left transition-colors ${
                on
                  ? "border-[var(--taiko-accent)] bg-[rgba(255,140,0,0.18)]"
                  : "border-[rgba(255,255,255,0.14)] bg-[rgba(0,0,0,0.28)] hover:border-[rgba(255,255,255,0.3)]"
              }`}
            >
              <span
                className={`text-xs font-semibold sm:text-sm ${on ? "text-[var(--taiko-accent)]" : "text-[rgba(255,255,255,0.85)]"}`}
              >
                {tr(d.label, d.labelEn)}
                {b?.completed && " ✓"}
              </span>
              <span className="truncate text-[10px] tabular-nums text-[rgba(255,255,255,0.6)]">
                {b ? `${b.score.toLocaleString()} · ${b.accuracy.toFixed(1)}%` : tr("未游玩", "Not played")}
              </span>
              <span className="h-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.12)]">
                <span
                  className="block h-full bg-[var(--taiko-accent)]"
                  style={{ width: `${b?.progress ?? 0}%` }}
                />
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => saveKitEnabled(!kitOn)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            kitOn
              ? "bg-[var(--taiko-accent)] text-[#12141a]"
              : "border border-[rgba(255,255,255,0.2)] bg-[rgba(0,0,0,0.28)] text-[rgba(255,255,255,0.75)]"
          }`}
        >
          {tr("鼓音色", "Drum sound")} {kitOn ? tr("开", "On") : tr("关", "Off")}
        </button>
        <select
          value={kitId}
          onChange={(e) => {
            const id = Number(e.target.value);
            saveKitId(id);
            if (loadKitEnabled()) void ensureKitLoaded(id);
          }}
          className="rounded-md border border-[var(--taiko-accent)] bg-[#1a1c22] px-2 py-1.5 text-xs text-[rgba(255,255,255,0.9)]"
        >
          {KIT_NAMES.map((k) => (
            <option key={k.id} value={k.id} className="bg-[#1a1c22] text-[rgba(255,255,255,0.9)]">
              {tr(k.zh, k.en)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
