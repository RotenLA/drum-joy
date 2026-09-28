/**
 * 游玩屏内的音游式选歌层：舞台在背后虚化，顶部横排「选择歌曲 / 历史演奏 / 搜索」，
 * 下方为斜切卡片横向排列：未选中淡色收窄，选中亮起变宽并出现「开始」。
 * 卡片可鼠标拖拽 / 触摸 / 滚轮左右滑动，两端留白让最外侧歌曲也能滑到画面中间。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSong } from "./songStore";
import { fetchLibrarySongs, decodeStoredSong, type LibrarySong } from "./songLibrary";
import { cancelDownload, downloadSong, readStoredAny, scanDownloads, useDownloads } from "./songDownloads";
import { LeaderboardDialog } from "./LeaderboardDialog";
import { songPlayer } from "./player";
import { emptyStems, hasAnyStem, stemsLeadMs } from "./stems";
import { useLanguage } from "./i18n";
import { clearHistory, loadPlayData, type BestMap, type HistoryEntry } from "./history";
import { CardControls } from "./CardControls";
import { DIFFICULTIES, type Difficulty } from "./difficulty";
import { BookOpen, Download, Loader2, LogOut, Play, Search, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";

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

/** 竖排歌名：过长则在卡片高度内循环滚动 */
function VerticalTitle({ title }: { title: string }) {
  const boxRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    const measure = () => {
      // 旋转 -90° 后，文本宽度对应卡片高度
      const over = text.scrollWidth - (box.clientHeight - 24);
      setShift(over > 8 ? over : 0);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [title]);

  return (
    <span ref={boxRef} className="relative block h-full w-full overflow-hidden">
      {/* 贴右侧的竖排条：文字绕自身中心逆时针 90°，不反向抵消卡片斜切，随斜边倾斜 */}
      <span className="absolute inset-y-0 right-0 block w-14 overflow-hidden">
        <span
          className="absolute left-1/2 top-1/2 block whitespace-nowrap"
          style={{ transform: "translate(-50%, -50%) rotate(-90deg)" }}
        >
          <span
            ref={textRef}
            className={`block whitespace-nowrap text-[26px] font-semibold tracking-wide text-[rgba(255,255,255,0.9)] ${
              shift ? "taiko-marquee-run" : ""
            }`}
            style={
              shift
                ? ({
                    "--taiko-marquee-shift": `${-shift}px`,
                    "--taiko-marquee-dur": `${Math.max(7, shift / 22)}s`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            {title}
          </span>
        </span>
      </span>
    </span>
  );
}

/** 展开卡片歌名：短标题静止，超出可用宽度时横向往返滚动。 */
function HorizontalTitle({ title }: { title: string }) {
  const boxRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    const measure = () => setShift(Math.max(0, text.scrollWidth - box.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(text);
    return () => ro.disconnect();
  }, [title]);

  return (
    <span ref={boxRef} className="block max-w-[calc(100%-8rem)] overflow-hidden">
      <span
        ref={textRef}
        className={`block w-max whitespace-nowrap text-2xl font-semibold text-[rgba(255,255,255,0.96)] ${
          shift > 4 ? "taiko-title-marquee" : ""
        }`}
        style={
          shift > 4
            ? ({
                "--taiko-marquee-shift": `${-shift}px`,
                "--taiko-marquee-dur": `${Math.max(7, shift / 22)}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {title}
      </span>
    </span>
  );
}

export function SongPicker({
  speed,
  onSpeedChange,
  onStart,
  onExit,
  onStartTutorial,
  exitLabel,
  onSecretUnlock,
}: {
  speed: number;
  onSpeedChange?: ((s: number) => void) | undefined;
  onStart: () => void;
  onExit?: (() => void) | undefined;
  onStartTutorial: () => void;
  /** 退出按钮文字（实验室里改成「返回」） */
  exitLabel?: string | undefined;
  /** 「选择歌曲」连续点击 12 次的隐藏入口 */
  onSecretUnlock?: (() => void) | undefined;
}) {
  const song = useSong();
  const { tr } = useLanguage();
  const tapRef = useRef({ count: 0, at: 0 });


  const [tab, setTab] = useState<"songs" | "history">("songs");
  const [library, setLibrary] = useState<LibrarySong[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listing, setListing] = useState(true);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bests, setBests] = useState<BestMap>({});
  const [synced, setSynced] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [warn, setWarn] = useState<string | null>(null);

  /** 就绪 = 当前全局歌曲确实加载完成（不依赖本层临时状态，中途退出回来依然有效） */
  const loadedSongId = song.songId && song.midi && hasAnyStem(song.stems) ? song.songId : null;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({ down: false, startX: 0, startScroll: 0, moved: 0 });

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
    void loadPlayData().then((r) => {
      setHistory(r.history);
      setBests(r.bests);
      setSynced(r.synced);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dl = useDownloads();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [boardFor, setBoardFor] = useState<LibrarySong | null>(null);
  useEffect(() => {
    void scanDownloads();
  }, []);
  // 当前已加载的歌默认展开
  useEffect(() => {
    if (loadedSongId && selectedId === null) setSelectedId(loadedSongId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedSongId]);

  const [pendingStart, setPendingStart] = useState<string | null>(null);
  useEffect(() => {
    if (pendingStart && loadedSongId === pendingStart) {
      setPendingStart(null);
      onStart();
    }
  }, [pendingStart, loadedSongId, onStart]);

  const isDl = (item: LibrarySong) => dl.done.has(`${item.id}|${item.fingerprint}`);

  /** 选中只展开，不下载 */
  const pickSong = useCallback(
    (item: LibrarySong, diff?: Difficulty, spd?: number) => {
      setSelectedId(item.id);
      setWarn(null);
      if (diff) song.setSong({ difficulty: diff });
      if (spd) onSpeedChange?.(spd);
      setTab("songs");
    },
    [song, onSpeedChange],
  );

  /** 已下载：解码（若未加载）后直接开始 */
  const startSong = useCallback(
    async (item: LibrarySong) => {
      if (loadingId) return;
      if (item.id === loadedSongId) {
        onStart();
        return;
      }
      setWarn(null);
      setPercent(0);
      setLoadingId(item.id);
      songPlayer.stop();
      // 先释放上一首的解码音频，避免两首同时占内存
      songPlayer.load(emptyStems());
      song.setSong({ stems: emptyStems(), songId: "" });
      try {
        const stored = await readStoredAny(item);
        if (!stored) throw new Error("not downloaded");
        const loaded = await decodeStoredSong(item, stored);
        const leadMs = stemsLeadMs(loaded.stems);
        songPlayer.setLeadMs(leadMs);
        songPlayer.load(loaded.stems);
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
        });
        // 等 stems 进入全局状态后再开始（见下方 effect）
        setPendingStart(item.id);
      } catch (err) {
        console.error(err);
        setWarn(tr("歌曲准备失败，请点「开始」重试", "Failed to prepare the song, tap PLAY to retry"));
      } finally {
        setLoadingId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadingId, loadedSongId, song, onStart, tr],
  );

  const filtered = useMemo(() => {
    const norm = (v: string) => v.normalize("NFKC").toLowerCase().replace(/[\s·\-_'"’.,，。]/g, "");
    const q = norm(query);
    if (!q) return library;
    return library.filter((s) => norm(`${s.title}${s.artist ?? ""}`).includes(q));
  }, [library, query]);
  // 搜索结果变化时把列表滚回开头，避免结果落在视野外看起来“搜索没反应”
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [query]);

  // 选中的卡片自动滚入视野
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || tab !== "songs") return;
    const el = box.querySelector<HTMLElement>('[data-active="1"]');
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selectedId, tab, filtered.length]);

  // 鼠标拖拽横向滑动（拖动超过阈值则吞掉后续 click）
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const box = scrollRef.current;
    if (!box) return;
    dragRef.current = { down: true, startX: e.clientX, startScroll: box.scrollLeft, moved: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const box = scrollRef.current;
    if (!d.down || !box) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > d.moved) d.moved = Math.abs(dx);
    box.scrollLeft = d.startScroll - dx;
  };
  const endDrag = () => {
    dragRef.current.down = false;
    window.setTimeout(() => (dragRef.current.moved = 0), 0);
  };
  const onWheel = (e: React.WheelEvent) => {
    const box = scrollRef.current;
    if (!box) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    box.scrollLeft += delta;
  };
  const guardClick = (fn: () => void) => () => {
    if (dragRef.current.moved > 8) return;
    fn();
  };

  const diffLabel = (d: Difficulty) => {
    const item = DIFFICULTIES.find((x) => x.id === d);
    return item ? tr(item.label, item.labelEn) : d;
  };
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[var(--taiko-picker-glass)] backdrop-blur-[16px]">
      {/* 顶部：退出常驻左侧，标签与搜索统一靠右；全局设置由演奏页统一承载 */}
      <div className="flex shrink-0 items-center gap-2 py-3 pl-14 pr-3 sm:pr-4">
        <Button
          variant="outline"
          type="button"
          onClick={onExit}
          className="h-9 shrink-0 gap-1.5 rounded-md border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-3 text-sm text-[rgba(255,255,255,0.76)] backdrop-blur-[18px] hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
        >
          <LogOut size={15} />
          {exitLabel ?? tr("退出", "Exit")}
        </Button>
        <div className="ml-auto flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onStartTutorial}
            aria-label={tr("进入教学", "Open tutorial")}
            title={tr("进入教学", "Open tutorial")}
            className="h-9 shrink-0 gap-1.5 rounded-md border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-2.5 text-[rgba(255,255,255,0.76)] hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
          >
            <BookOpen size={15} />
            <span className="hidden sm:inline">{tr("教学", "Tutorial")}</span>
          </Button>
          {(
            [
              ["songs", tr("选择歌曲", "Songs")],
              ["history", tr("历史演奏", "History")],
            ] as const
          ).map(([id, label]) => (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            onClick={() => {
              setTab(id);
              if (id !== "songs" || !onSecretUnlock) return;
              // 隐藏入口：4 秒内连点 12 次「选择歌曲」进入测试版本
              const t = tapRef.current;
              const now = Date.now();
              t.count = now - t.at > 4000 ? 1 : t.count + 1;
              t.at = now;
              if (t.count >= 12) {
                t.count = 0;
                onSecretUnlock();
              }
            }}

            className={`h-9 min-w-24 shrink-0 rounded-md px-3 text-sm tracking-wide sm:px-4 ${
              tab === id
                ? "bg-[var(--taiko-accent)] text-[#12141a]"
                : "bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.16)]"
            }`}
          >
            {label}
          </Button>
          ))}

          <label className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-2.5 py-1.5 backdrop-blur-[18px] sm:px-3">
            <Search size={14} className="shrink-0 text-[rgba(255,255,255,0.5)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              onPointerDown={(e) => e.stopPropagation()}
              type="search"
              enterKeyHint="search"
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
        <div
          ref={scrollRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onWheel={onWheel}
          className="taiko-hscroll flex min-h-0 flex-1 cursor-grab items-center gap-3 overflow-x-auto overflow-y-hidden pb-5 pt-1 active:cursor-grabbing"
          // 右侧留白足够多：可一直右滑到只剩最后一首露出一部分在界面内
          style={{ paddingLeft: "1rem", paddingRight: "max(1rem, calc(100vw - 160px))" }}
        >
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
            const busyThis = loadingId === item.id;
            const wide = selectedId === item.id;
            const ready = wide;
            const downloaded = isDl(item);
            const downloading = dl.activeId === item.id;
            return (
              <div
                key={item.id}
                data-active={wide ? "1" : "0"}
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
                  onClick={guardClick(() => pickSong(item))}
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
                  {downloading && (
                    <span
                      className="absolute inset-y-0 left-0 bg-[var(--taiko-accent-progress)] transition-[width] duration-200"
                      style={{ width: `${dl.percent}%` }}
                    />
                  )}

                  {wide ? (
                    <span
                      className="relative z-10 flex h-full flex-col justify-end gap-1 p-5"
                      style={{ transform: "skewX(9deg)" }}
                    >
                      <HorizontalTitle title={item.title} />
                      <span className="truncate text-xs tabular-nums text-[rgba(255,255,255,0.65)]">
                        {fmtTime(item.durationMs)} · BPM {item.bpm} · {item.timeSignature[0]}/
                        {item.timeSignature[1]}
                      </span>
                      {downloaded && (
                        <span className="text-[11px] text-[var(--taiko-accent)]">
                          {tr("已下载", "Downloaded")}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="relative z-10 block h-full w-full">
                      <VerticalTitle title={item.title} />
                    </span>
                  )}
                </button>

                {ready && (
                  <div className="absolute inset-x-8 top-[44%] z-20 -translate-y-1/2">
                    <CardControls
                      songId={item.id}
                      bests={bests}
                    />
                  </div>
                )}

                {ready && (
                  <button
                    type="button"
                    onClick={guardClick(() => setBoardFor(item))}
                    aria-label={tr("排行榜", "Leaderboard")}
                    className="absolute right-6 top-4 z-20 flex h-9 items-center gap-1.5 rounded-md border border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-3 text-xs text-[rgba(255,255,255,0.8)] hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
                    style={{ transform: "skewX(9deg)" }}
                  >
                    <Trophy size={14} />
                    {tr("排行榜", "Ranking")}
                  </button>
                )}

                {ready && (
                  <button
                    type="button"
                    onClick={guardClick(() => {
                      if (downloading) cancelDownload();
                      else if (downloaded) void startSong(item);
                      else void downloadSong(item);
                    })}
                    disabled={busyThis}
                    className="absolute bottom-4 right-4 z-20 flex h-10 min-w-[7.5rem] items-center justify-center gap-2 rounded-md bg-[var(--taiko-accent)] px-5 text-sm font-semibold tracking-[0.15em] text-[var(--taiko-paper)] transition-transform hover:scale-[1.04] disabled:opacity-70"
                  >
                    {busyThis ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {tr("准备中", "Loading")}
                      </>
                    ) : downloading ? (
                      <>
                        <X size={16} />
                        {dl.percent}%
                      </>
                    ) : downloaded ? (
                      <>
                        <Play size={16} />
                        {tr("开始", "PLAY")}
                      </>
                    ) : (
                      <>
                        <Download size={16} />
                        {dl.errorId === item.id ? tr("重试", "Retry") : tr("下载", "Download")}
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="taiko-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          {history.length > 0 && !synced && (
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
              const unfinished = h.completed === false;
              return (
                <button
                  key={`${h.playedAt}-${i}`}
                  onClick={() => {
                    if (item) pickSong(item, h.difficulty, h.speed);
                  }}
                  disabled={!item}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-left text-sm text-[rgba(255,255,255,0.85)] hover:text-[var(--taiko-accent)] disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">{h.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[rgba(255,255,255,0.55)]">
                    {unfinished
                      ? `${tr("未完成", "Unfinished")} ${h.progress ?? 0}% · `
                      : ""}
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
      {boardFor && (
        <LeaderboardDialog song={boardFor} difficulty={song.difficulty} onClose={() => setBoardFor(null)} />
      )}
    </div>
  );
}
