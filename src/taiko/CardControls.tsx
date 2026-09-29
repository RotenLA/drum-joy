/**
 * 选中歌曲卡片内的操作区：难度（带最佳成绩/进度）+ 手机音色开关 + 鼓组。
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
import { isUnlocked, unlockRequirement, type BestMap } from "./history";
import { Lock } from "lucide-react";
import { ratingOfAccuracy } from "./rating";
import { HelpDot } from "@/components/HelpDot";
import { helpText } from "./helpTexts";
import { Button } from "@/components/ui/button";

export function CardControls({
  songId,
  bests,
}: {
  songId: string;
  bests: BestMap;
}) {
  const song = useSong();
  const { tr, language } = useLanguage();
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
      className="mx-auto flex w-full max-w-[390px] flex-col items-center gap-2 sm:gap-3"
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
          const open = isUnlocked(bests, songId, d.id);
          const req = unlockRequirement(d.id);
          const reqItem = DIFFICULTIES.find((x) => x.id === req);
          return (
            <Button
              key={d.id}
              variant="outline"
              type="button"
              disabled={!open}
              title={
                !open && reqItem
                  ? tr(`${reqItem.label}全连击后解锁`, `Full combo ${reqItem.labelEn} to unlock`)
                  : undefined
              }
              onClick={() => open && song.setSong({ difficulty: d.id })}
              className={`h-9 min-w-0 rounded-md px-1.5 text-center ${
                on
                  ? "border-[var(--taiko-accent)] bg-[rgba(255,140,0,0.18)]"
                  : "border-[rgba(255,255,255,0.14)] bg-[rgba(0,0,0,0.28)] hover:border-[rgba(255,255,255,0.3)]"
              }`}
            >
              <span
                className={`flex min-w-0 items-center justify-center whitespace-nowrap text-[10px] font-semibold sm:text-xs ${on ? "text-[var(--taiko-accent)]" : "text-[rgba(255,255,255,0.85)]"}`}
              >
                {!open && <Lock size={11} className="mr-1 inline -translate-y-px" />}
                {tr(d.label, d.labelEn)}
              </span>
            </Button>
          );
        })}
      </div>
      {(!isUnlocked(bests, songId, "standard") || !isUnlocked(bests, songId, "hard")) && (
        <p className="-mt-1 max-w-full text-center text-[10px] leading-4 text-[rgba(255,255,255,0.55)]">
          {!isUnlocked(bests, songId, "standard")
            ? tr("入门全连击解锁标准，标准全连击解锁困难", "Full combo Beginner to unlock Standard, Standard to unlock Hard")
            : tr("标准全连击解锁困难", "Full combo Standard to unlock Hard")}
        </p>
      )}
      <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
        <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => saveKitEnabled(!kitOn)}
            className={`h-8 min-w-0 whitespace-nowrap rounded-md px-2 text-[11px] font-semibold ${
              kitOn
                ? "bg-[var(--taiko-accent)] text-[#12141a]"
                : "border border-[rgba(255,255,255,0.2)] bg-[rgba(0,0,0,0.28)] text-[rgba(255,255,255,0.75)]"
            }`}
          >
            {tr("手机音色", "Mobile sound")} {kitOn ? tr("开", "On") : tr("关", "Off")}
          </Button>
          <HelpDot
            label={tr("手机音色", "Mobile sound")}
            text={helpText("kit", language)}
          />
        </span>
        <select
          value={kitId}
          onChange={(e) => {
            const id = Number(e.target.value);
            saveKitId(id);
            if (loadKitEnabled()) void ensureKitLoaded(id);
          }}
          className="h-8 min-w-0 rounded-md border border-[var(--taiko-accent)] bg-[#1a1c22] px-2 text-[11px] text-[rgba(255,255,255,0.9)]"
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
