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
import { ratingOfAccuracy } from "./rating";

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

export function CardControls({
  songId,
  bests,
  speed,
  onSpeedChange,
}: {
  songId: string;
  bests: BestMap;
  speed: number;
  onSpeedChange?: ((speed: number) => void) | undefined;
}) {
  const song = useSong();
  const { tr } = useLanguage();
  const [kitOn, setKitOn] = useState(true);
  const [kitId, setKitId] = useState(0);
  const currentBest = bests[`${songId}|${song.difficulty}`];
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
      className="mx-auto flex w-full max-w-[360px] flex-col items-center gap-2 sm:gap-3"
      onClick={stop}
      onPointerDown={stop}
    >
      <div className="flex h-14 w-full items-center justify-center gap-3 text-center">
        {!currentBest ? (
          <span className="text-lg font-semibold text-[rgba(255,255,255,0.72)]">
            {tr("未游玩", "Not played")}
          </span>
        ) : currentBest.completed ? (
          <>
            <span className="text-4xl font-black text-[var(--taiko-accent)]">
              {ratingOfAccuracy(currentBest.accuracy)}
            </span>
            <span className="flex flex-col items-start">
              <span className="text-xl font-bold tabular-nums text-[rgba(255,255,255,0.96)]">
                {currentBest.score.toLocaleString()}
              </span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-[rgba(255,255,255,0.5)]">
                {tr("最佳分数", "Best score")}
              </span>
            </span>
          </>
        ) : (
          <span className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-[rgba(255,255,255,0.82)]">
              {tr("未完成", "Incomplete")}
            </span>
            <span className="text-2xl font-bold tabular-nums text-[var(--taiko-accent)]">
              {currentBest.progress}%
            </span>
          </span>
        )}
      </div>
      <div className="grid w-full grid-cols-4 gap-1.5">
        {DIFFICULTIES.map((d) => {
          const on = song.difficulty === d.id;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => song.setSong({ difficulty: d.id })}
              className={`flex min-w-0 items-center justify-center rounded-md border px-1.5 py-2 text-center transition-colors ${
                on
                  ? "border-[var(--taiko-accent)] bg-[rgba(255,140,0,0.18)]"
                  : "border-[rgba(255,255,255,0.14)] bg-[rgba(0,0,0,0.28)] hover:border-[rgba(255,255,255,0.3)]"
              }`}
            >
              <span
                className={`text-xs font-semibold sm:text-sm ${on ? "text-[var(--taiko-accent)]" : "text-[rgba(255,255,255,0.85)]"}`}
              >
                {tr(d.label, d.labelEn)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex w-full flex-wrap items-center justify-center gap-2">
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
      <div className="flex w-full items-center justify-center gap-1.5">
        <span className="mr-0.5 text-[10px] text-[rgba(255,255,255,0.6)]">
          {tr("下落速度", "Fall speed")}
        </span>
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onSpeedChange?.(value)}
            className={`min-w-10 rounded-md border px-2 py-1 text-xs tabular-nums transition-colors ${
              speed === value
                ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent)] text-[#12141a]"
                : "border-[rgba(255,255,255,0.2)] bg-[rgba(0,0,0,0.28)] text-[rgba(255,255,255,0.75)] hover:border-[rgba(255,255,255,0.35)]"
            }`}
          >
            {value}x
          </button>
        ))}
      </div>
    </div>
  );
}
