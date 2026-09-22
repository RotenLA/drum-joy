/**
 * 游玩屏内的音游式选歌层：舞台在背后虚化，顶部横排「选择歌曲 / 历史演奏 / 搜索」，
 * 下方为斜切卡片横向排列：未选中淡色收窄，选中亮起变宽并出现「开始」。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSong } from "./songStore";
import { fetchLibrarySongs, loadLibrarySong, type LibrarySong } from "./songLibrary";
import { songPlayer } from "./player";
import { STEM_KINDS, stemsLeadMs } from "./stems";
import { useLanguage } from "./i18n";
import { clearHistory, readHistory, type HistoryEntry } from "./history";
import { DIFFICULTIES, type Difficulty } from "./difficulty";
import { LogOut, Play, Search, Settings } from "lucide-react";

const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** 卡片底色渐变：按索引循环，整体低饱和，与暗色舞台背景相配 */
const CARD_GRADIENTS = [
  "linear-gradient(150deg, #2b3a5c 0%, #3d5a7d 55%, #24304a 100%)",
  "linear-gradient(150deg, #4a2f4f 0%, #6b3f63 55%, #2e1f34 100%)",
  "linear-gradient(150deg, #2c4a47 0%, #3f6d63 55%, #1e3230 100%)",
  "linear-gradient(150deg, #4c3a28 0%, #7a5a33 55%, #322618 100%)",
  "linear-gradient(150deg, #33305c 0%, #4d4a86 55%, #211f3c 100%)",
];

export function SongPicker({
  speed,
  onSpeedChange,
  onStart,
  onOpenSettings,
  onExit,
}: {
  speed: number;
  onSpeedChange?: ((s: number) => void) | undefined;
  onStart: () => void;
  onOpenSettings: () => void;
  onExit?: (() => void) | undefined;
}) {
  const song = useSong();
  const { tr } = useLanguage();

  const [tab, setTab] = useState<"songs" | "history">("songs");
  const [library, setLibrary] = useState<LibrarySong[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listing, setListing] = useState(true);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [ready, setReady] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLibrary(await fetchLibrarySongs());
      } catch {
        setListErr(tr("曲库读取失败，请稍后重试", "Failed to load the song library"));
      } finally {
        setListing(false);
      }
    })();
    setHistory(readHistory());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickSong = useCallback(
    async (item: LibrarySong, diff?: Difficulty, spd?: number) => {
      if (loadingId) return;
      setWarn(null);
      setReady(false);
      setPercent(0);
      setLoadingId(item.id);
      songPlayer.stop();
      try {
        const loaded = await loadLibrarySong(item, (p) => setPercent(Math.round(p)));
        const leadMs = stemsLeadMs(loaded.stems);
        songPlayer.setLeadMs(leadMs);
        songPlayer.load(loaded.stems);
        for (const kind of STEM_KINDS) songPlayer.setStemGain(kind, song.mix[kind]);
        song.setSong({
          stems: loaded.stems,
          midi: loaded.midi,
          midiFileName: loaded.midiFileName,
          fileName: loaded.title,
          songId: item.id,
          offsetMs: 0,
          phaseBeatOffset: 0,
          bpm: Math.round(loaded.midi.bpm * 100) / 100,
          timeSignature: loaded.midi.timeSignature,
          audioLeadMs: leadMs,
          chart: null,
          ...(diff ? { difficulty: diff } : {}),
        });
        if (spd) onSpeedChange?.(spd);
        setReady(true);
        setTab("songs");
      } catch (err) {
        console.error(err);
        setWarn(tr("加载失败，请检查网络后重试", "Failed to load, check your network and retry"));
      } finally {
        setLoadingId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadingId, song, onSpeedChange, tr],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return library;
    return library.filter(
      (s) => s.title.toLowerCase().includes(q) || (s.artist ?? "").toLowerCase().includes(q),
    );
  }, [library, query]);

  const diffLabel = (d: Difficulty) => {
    const item = DIFFICULTIES.find((x) => x.id === d);
    return item ? tr(item.label, item.labelEn) : d;
  };
  const curDiff = diffLabel(song.difficulty);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[var(--taiko-picker-glass)] backdrop-blur-[16px]">
      {/* 顶部：退出独立在左，标签与搜索统一靠右 */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-3 sm:px-4">
        <button
          type="button"
          onClick={onExit}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-3 py-2 text-sm text-[rgba(255,255,255,0.76)] backdrop-blur-[18px] transition-colors hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
        >
          <LogOut size={15} />
          {tr("退出", "Exit")}
        </button>

        <div className="ml-auto flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
          {(
            [
              ["songs", tr("选择歌曲", "Songs")],
              ["history", tr("历史演奏", "History")],
            ] as const
          ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`shrink-0 rounded-md px-2.5 py-2 text-xs tracking-wide transition-colors sm:px-4 sm:text-sm ${
              tab === id
                ? "bg-[var(--taiko-accent)] text-[#12141a]"
                : "bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.16)]"
            }`}
          >
            {label}
          </button>
          ))}

          <label className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-2.5 py-1.5 backdrop-blur-[18px] sm:px-3">
            <Search size={14} className="shrink-0 text-[rgba(255,255,255,0.5)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("搜索歌名或艺人", "Search title or artist")}
              className="w-28 min-w-0 bg-transparent text-base text-[rgba(255,255,255,0.9)] outline-none placeholder:text-[rgba(255,255,255,0.35)] sm:w-56"
            />
          </label>
        </div>
      </div>

      {(warn || listErr) && (
        <p className="px-4 pb-1 text-xs text-[var(--taiko-accent)]">{warn ?? listErr}</p>
      )}

      {tab === "songs" ? (
        <div className="taiko-scroll flex min-h-0 flex-1 items-center gap-3 overflow-x-auto overflow-y-hidden px-4 pb-5 pt-1">
          {listing && (
            <p className="m-auto text-xs text-[rgba(255,255,255,0.55)]">
              {tr("正在读取曲库…", "Loading library…")}
            </p>
          )}
          {!listing && !filtered.length && (
            <p className="m-auto text-xs text-[rgba(255,255,255,0.55)]">
              {library.length
                ? tr("没有匹配的歌曲", "No matching songs")
                : tr("曲库还没有歌曲", "The library is empty")}
            </p>
          )}
          {filtered.map((item, i) => {
            const active = song.songId === item.id;
            const busyThis = loadingId === item.id;
            const wide = active || busyThis;
            return (
              <div
                key={item.id}
                className="relative shrink-0 rounded-lg transition-all duration-300"
                style={{
                  height: "min(86%, 360px)",
                  width: wide ? "min(72vw, 420px)" : "clamp(84px, 13vw, 124px)",
                  transform: "skewX(-9deg)",
                  opacity: wide ? 1 : 0.72,
                }}
              >
                <button
                  type="button"
                  onClick={() => void pickSong(item)}
                  disabled={loadingId !== null}
                  className={`relative block h-full w-full overflow-hidden rounded-lg border text-left shadow-xl backdrop-blur-[18px] transition-all duration-300 ${
                    wide
                      ? "border-[var(--taiko-accent)] ring-1 ring-[var(--taiko-accent)]"
                      : "border-[var(--taiko-glass-line)] opacity-80 hover:border-[var(--taiko-glass-line-strong)] hover:opacity-100"
                  }`}
                  style={{ background: CARD_GRADIENTS[i % CARD_GRADIENTS.length] }}
                >
                  {/* 未选中：淡色蒙层压暗 */}
                  <span
                    className="absolute inset-0 transition-opacity duration-300"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(10,12,18,0.15), rgba(10,12,18,0.85))",
                      opacity: wide ? 0.55 : 0.8,
                    }}
                  />
                  {busyThis && (
                    <span
                      className="absolute inset-y-0 left-0 bg-[var(--taiko-accent-progress)] transition-[width] duration-200"
                      style={{ width: `${percent}%` }}
                    />
                  )}

                  {wide ? (
                    <span
                      className="relative z-10 flex h-full flex-col justify-end gap-1 p-5"
                      style={{ transform: "skewX(9deg)" }}
                    >
                      <span className="truncate text-xl font-semibold text-[rgba(255,255,255,0.96)]">
                        {item.title}
                      </span>
                      <span className="truncate text-xs tabular-nums text-[rgba(255,255,255,0.65)]">
                        {item.artist ? `${item.artist} · ` : ""}
                        {fmtTime(item.durationMs)} · BPM {item.bpm} · {item.timeSignature[0]}/
                        {item.timeSignature[1]}
                      </span>
                      <span className="text-[11px] tabular-nums text-[var(--taiko-accent)]">
                        {busyThis
                          ? `${percent}%`
                          : `${curDiff} · ${speed}x · ${tr("已就绪", "Ready")}`}
                      </span>
                    </span>
                  ) : (
                    <span
                      className="relative z-10 flex h-full items-center justify-center overflow-hidden"
                    >
                      <span
                        className="block max-w-[280px] shrink-0 truncate whitespace-nowrap text-sm tracking-wide text-[rgba(255,255,255,0.85)]"
                        style={{ transform: "skewX(9deg) rotate(-90deg)" }}
                      >
                        {item.title}
                      </span>
                    </span>
                  )}
                </button>

                {active && ready && !loadingId && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    aria-label={tr("全局设置", "Global settings")}
                    className="absolute right-4 top-4 z-20 grid h-9 w-9 place-items-center rounded-md border border-[var(--taiko-glass-line-strong)] bg-[var(--taiko-glass-strong)] text-[var(--taiko-ink)]/80 backdrop-blur-[18px] transition-colors hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
                  >
                    <Settings size={17} />
                  </button>
                )}

                {active && ready && !loadingId && (
                  <button
                    type="button"
                    onClick={onStart}
                    className="absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-md bg-[var(--taiko-accent)] px-5 py-2.5 text-sm font-semibold tracking-[0.2em] text-[var(--taiko-paper)] transition-transform hover:scale-[1.04]"
                  >
                    <Play size={16} />
                    {tr("开始", "PLAY")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="taiko-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          {history.length > 0 && (
            <button
              onClick={() => {
                clearHistory();
                setHistory([]);
              }}
              className="mb-2 text-xs text-[rgba(255,255,255,0.55)] hover:text-[var(--taiko-accent)]"
            >
              {tr("清空记录", "Clear")}
            </button>
          )}
          <div className="flex flex-col divide-y divide-[rgba(255,255,255,0.1)]">
            {history.map((h, i) => {
              const item = library.find((s) => s.id === h.songId);
              return (
                <button
                  key={`${h.playedAt}-${i}`}
                  onClick={() => {
                    if (item) void pickSong(item, h.difficulty, h.speed);
                  }}
                  disabled={!item || loadingId !== null}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-left text-sm text-[rgba(255,255,255,0.85)] hover:text-[var(--taiko-accent)] disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">{h.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[rgba(255,255,255,0.55)]">
                    {diffLabel(h.difficulty)} · {h.speed}x · {tr("准确率", "Acc")}{" "}
                    {(h.accuracy ?? 0).toFixed(1)}% · {tr("连击", "Combo")} {h.maxCombo ?? 0} ·{" "}
                    {new Date(h.playedAt).toLocaleString()}
                  </span>
                </button>
              );
            })}
            {!history.length && (
              <p className="py-8 text-center text-xs text-[rgba(255,255,255,0.5)]">
                {tr("还没有演奏记录", "No plays yet")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
