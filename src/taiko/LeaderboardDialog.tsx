/** 单曲单难度全球排行榜弹窗：前 20 名 + 我的名次 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getLeaderboard, type BoardRow } from "@/lib/plays.functions";
import type { LibrarySong } from "./songLibrary";
import { DIFFICULTIES, type Difficulty } from "./difficulty";
import { getHostUserId } from "./history";
import { ratingOfAccuracy } from "./rating";
import { useLanguage } from "./i18n";

export function LeaderboardDialog({
  song,
  difficulty,
  onClose,
}: {
  song: LibrarySong;
  difficulty: Difficulty;
  onClose: () => void;
}) {
  const { tr } = useLanguage();
  const [diff, setDiff] = useState<Difficulty>(difficulty);
  const [data, setData] = useState<{ top: BoardRow[]; mine: BoardRow | null } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(false);
    getLeaderboard({ data: { songId: song.id, difficulty: diff, userId: getHostUserId() } })
      .then((r) => alive && setData(r))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [song.id, diff]);

  const row = (r: BoardRow) => (
    <div
      key={`${r.rank}-${r.name}`}
      className={`grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem_5.5rem] items-center gap-2 px-3 py-2 text-sm ${
        r.me ? "bg-[rgba(255,140,0,0.16)] text-[var(--taiko-accent)]" : "text-[rgba(255,255,255,0.85)]"
      }`}
    >
      <span className="font-bold tabular-nums">#{r.rank}</span>
      <span className="truncate">{r.name}</span>
      <span className="text-center font-black">{ratingOfAccuracy(r.accuracy)}</span>
      <span className="text-right tabular-nums">{r.score.toLocaleString()}</span>
    </div>
  );

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-xl border border-[var(--taiko-glass-line)] bg-[rgba(18,20,28,0.9)] backdrop-blur-[18px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--taiko-glass-line)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs tracking-[0.2em] text-[var(--taiko-accent)]">{tr("全球排行榜", "Global ranking")}</p>
            <p className="truncate text-base font-semibold text-white">{song.title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tr("关闭", "Close")} className="text-white/70 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5 px-4 py-3">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDiff(d.id)}
              className={`h-9 rounded-md border text-xs font-semibold ${
                diff === d.id
                  ? "border-[var(--taiko-accent)] bg-[rgba(255,140,0,0.18)] text-[var(--taiko-accent)]"
                  : "border-[rgba(255,255,255,0.14)] bg-[rgba(0,0,0,0.28)] text-white/80"
              }`}
            >
              {tr(d.label, d.labelEn)}
            </button>
          ))}
        </div>
        <div className="taiko-scroll min-h-0 flex-1 overflow-y-auto pb-2">
          {err && <p className="py-8 text-center text-xs text-white/55">{tr("排行榜读取失败", "Failed to load")}</p>}
          {!err && !data && <p className="py-8 text-center text-xs text-white/55">{tr("读取中…", "Loading…")}</p>}
          {data && !data.top.length && (
            <p className="py-8 text-center text-xs text-white/55">{tr("还没有人上榜，来当第一名", "No scores yet — be the first")}</p>
          )}
          {data?.top.map(row)}
        </div>
        {data?.mine && !data.top.some((r) => r.me) && (
          <div className="border-t border-[var(--taiko-glass-line)]">{row(data.mine)}</div>
        )}
      </div>
    </div>
  );
}
