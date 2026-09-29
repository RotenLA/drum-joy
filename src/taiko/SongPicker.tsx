/**
 * 游玩屏内的歌单层：舞台在背后虚化，首页横向展示歌单，
 * 进入后使用 Phigros 式纵向吸附歌曲轨道浏览歌曲与详情。
 * 卡片可鼠标拖拽 / 触摸 / 滚轮左右滑动，两端留白让最外侧歌曲也能滑到画面中间。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSong } from "./songStore";
import { fetchLibrary, decodeStoredSong, type LibrarySong, type LibraryTag } from "./songLibrary";
import { cancelDownload, downloadSong, readStoredAny, scanDownloads, useDownloads } from "./songDownloads";
import { LeaderboardDialog } from "./LeaderboardDialog";
import { songPlayer } from "./player";
import { emptyStems, hasAnyStem, stemsLeadMs } from "./stems";
import { useLanguage } from "./i18n";
import { isUnlocked, loadFavorites, loadPlayData, setFavorite, type BestMap, type HistoryEntry } from "./history";
import { CardControls } from "./CardControls";
import type { Difficulty } from "./difficulty";
import { ArrowLeft, BookOpen, Download, Heart, Loader2, LogOut, Play, Trophy, X } from "lucide-react";
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

const DETAIL_SKEW = -8;

function detailSlotTop(): number {
  return Math.max(112, Math.min(160, window.innerHeight * 0.2));
}

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
}: {
  speed: number;
  onSpeedChange?: ((s: number) => void) | undefined;
  onStart: () => void;
  onExit?: (() => void) | undefined;
  onStartTutorial: () => void;
  /** 退出按钮文字（实验室里改成「返回」） */
  exitLabel?: string | undefined;
}) {
  const song = useSong();
  const { tr } = useLanguage();
  const [library, setLibrary] = useState<LibrarySong[]>([]);
  const [tags, setTags] = useState<LibraryTag[]>([]);
  const [favs, setFavs] = useState<string[]>([]);
  /** 当前打开的歌单：null=歌单列表；"fav"=我的收藏；"untagged"=未分类；其余为标签 id */
  const [openList, setOpenList] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listing, setListing] = useState(true);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bests, setBests] = useState<BestMap>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [warn, setWarn] = useState<string | null>(null);

  /** 就绪 = 当前全局歌曲确实加载完成（不依赖本层临时状态，中途退出回来依然有效） */
  const loadedSongId = song.songId && song.midi && hasAnyStem(song.stems) ? song.songId : null;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const detailScrollRef = useRef<HTMLDivElement | null>(null);
  const detailScrollTimerRef = useRef<number | null>(null);
  const dragRef = useRef({ down: false, startX: 0, startScroll: 0, moved: 0 });

  useEffect(() => {
    void (async () => {
      try {
        const lib = await fetchLibrary();
        setLibrary(lib.songs);
        setTags(lib.tags);
      } catch {
        setListErr(tr("曲库读取失败，请稍后重试", "Failed to load the song library"));
      } finally {
        setListing(false);
      }
    })();
    void loadFavorites().then(setFavs);
    void loadPlayData().then((r) => {
      setHistory(r.history);
      setBests(r.bests);
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
  const startRef = useRef(onStart);
  startRef.current = onStart;
  useEffect(() => {
    if (pendingStart && loadedSongId === pendingStart) {
      setPendingStart(null);
      // 父层装载音频的 effect 会把状态重置为选歌，需排在它之后再开始
      window.setTimeout(() => startRef.current(), 80);
    }
  }, [pendingStart, loadedSongId]);

  const isDl = (item: LibrarySong) => dl.done.has(`${item.id}|${item.fingerprint}`);

  const listSongs = (key: string): LibrarySong[] => {
    if (key === "fav") {
      const m = new Map(library.map((x) => [x.id, x]));
      return favs.map((id) => m.get(id)).filter((x): x is LibrarySong => !!x);
    }
    if (key === "untagged") return library.filter((x) => x.tagIds.length === 0);
    if (key === "history") {
      const byId = new Map(library.map((item) => [item.id, item]));
      const seen = new Set<string>();
      const songs: LibrarySong[] = [];
      for (const entry of history) {
        if (seen.has(entry.songId)) continue;
        const item = byId.get(entry.songId);
        if (!item) continue;
        seen.add(entry.songId);
        songs.push(item);
      }
      return songs;
    }
    return library.filter((x) => x.tagIds.includes(key));
  };
  const playlists = useMemo(() => {
    const out: { key: string; name: string; count: number }[] = [];
    const favoriteCount = listSongs("fav").length;
    const historyCount = listSongs("history").length;
    if (favoriteCount) out.push({ key: "fav", name: tr("我的收藏", "Favorites"), count: favoriteCount });
    if (historyCount) out.push({ key: "history", name: tr("历史", "History"), count: historyCount });
    for (const t of tags) out.push({ key: t.id, name: t.name, count: library.filter((x) => x.tagIds.includes(t.id)).length });
    const un = library.filter((x) => x.tagIds.length === 0).length;
    if (un) out.push({ key: "untagged", name: tr("未分类", "Uncategorized"), count: un });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, tags, favs, history, tr]);
  const toggleFav = (id: string) => {
    const on = !favs.includes(id);
    setFavs((f) => (on ? [id, ...f] : f.filter((x) => x !== id)));
    void setFavorite(id, on);
  };

  /** 选中只展开，不下载 */
  const pickSong = useCallback(
    (item: LibrarySong, diff?: Difficulty, spd?: number) => {
      setSelectedId(item.id);
      setWarn(null);
      setOpenList((cur) =>
        cur && listSongs(cur).some((x) => x.id === item.id)
          ? cur
          : (item.tagIds[0] ?? "untagged"),
      );
      if (diff) song.setSong({ difficulty: diff });
      if (spd) onSpeedChange?.(spd);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [song, onSpeedChange, library, favs],
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

  const activeSongs = useMemo(
    () => (openList ? listSongs(openList) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [library, openList, favs, history],
  );
  const selected = activeSongs.find((x) => x.id === selectedId) ?? null;
  const activePlaylist = playlists.find((item) => item.key === openList) ?? null;
  // 难度被锁时回落到入门
  useEffect(() => {
    if (selected && !isUnlocked(bests, selected.id, song.difficulty)) song.setSong({ difficulty: "beginner" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, bests, song.difficulty]);
  // 选中的卡片自动滚入视野
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const el = box.querySelector<HTMLElement>('[data-active="1"]');
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selectedId, activeSongs.length]);

  const settleDetailSelection = useCallback(() => {
    const box = detailScrollRef.current;
    if (!box) return;
    const targetTop = box.scrollTop + detailSlotTop();
    let nearest: { id: string; distance: number; element: HTMLElement } | null = null;
    for (const element of Array.from(box.querySelectorAll<HTMLElement>("[data-song-id]"))) {
      const distance = Math.abs(element.offsetTop - targetTop);
      if (!nearest || distance < nearest.distance) {
        nearest = { id: element.dataset["songId"] ?? "", distance, element };
      }
    }
    if (!nearest?.id) return;
    const item = activeSongs.find((candidate) => candidate.id === nearest?.id);
    if (item && item.id !== selectedId) pickSong(item);
    box.scrollTo({ top: Math.max(0, nearest.element.offsetTop - detailSlotTop()), behavior: "smooth" });
  }, [activeSongs, pickSong, selectedId]);

  const onDetailScroll = () => {
    if (detailScrollTimerRef.current !== null) window.clearTimeout(detailScrollTimerRef.current);
    detailScrollTimerRef.current = window.setTimeout(settleDetailSelection, 110);
  };

  useEffect(() => () => {
    if (detailScrollTimerRef.current !== null) window.clearTimeout(detailScrollTimerRef.current);
  }, []);

  useEffect(() => {
    if (!openList || !selectedId) return;
    const frame = window.requestAnimationFrame(() => {
      const box = detailScrollRef.current;
      const element = box?.querySelector<HTMLElement>(`[data-song-id="${selectedId}"]`);
      if (box && element) box.scrollTo({ top: Math.max(0, element.offsetTop - detailSlotTop()), behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openList, selectedId]);

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

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[var(--taiko-picker-glass)] backdrop-blur-[16px]">
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-3 pl-14 pr-3 sm:pr-4">
        <div className="flex min-w-0 items-center gap-2">
          {openList ? (
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setOpenList(null);
                setSelectedId(null);
              }}
              className="h-9 shrink-0 gap-1.5 rounded-md border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-3 text-sm text-[rgba(255,255,255,0.76)] backdrop-blur-[18px] hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
            >
              <ArrowLeft size={15} />
              {tr("返回", "Back")}
            </Button>
          ) : (
            <Button
              variant="outline"
              type="button"
              onClick={onExit}
              className="h-9 shrink-0 gap-1.5 rounded-md border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-3 text-sm text-[rgba(255,255,255,0.76)] backdrop-blur-[18px] hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
            >
              <LogOut size={15} />
              {exitLabel ?? tr("退出", "Exit")}
            </Button>
          )}
        </div>
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
          <span>{tr("教学", "Tutorial")}</span>
        </Button>
      </div>

      {(warn || listErr) && (
        <p className="px-4 pb-1 text-xs text-[var(--taiko-accent)]">{warn ?? listErr}</p>
      )}

      {!openList ? (
        <div
          ref={scrollRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onWheel={onWheel}
          className="taiko-hscroll flex min-h-0 flex-1 cursor-grab items-center gap-5 overflow-x-auto overflow-y-hidden px-[8vw] pb-5 pt-1 active:cursor-grabbing"
        >
          {listing && (
            <p className="m-auto text-xs text-[rgba(255,255,255,0.55)]">
              {tr("正在读取曲库…", "Loading library…")}
            </p>
          )}
          {!listing && playlists.map((pl, i) => (
            <Button
              key={pl.key}
              variant="outline"
              type="button"
              onClick={guardClick(() => {
                setOpenList(pl.key);
                const first = listSongs(pl.key)[0];
                setSelectedId(first?.id ?? null);
              })}
              className="relative h-[min(82%,430px)] w-[clamp(320px,42vw,520px)] shrink-0 items-stretch justify-start overflow-hidden rounded-lg border border-[var(--taiko-glass-line)] p-0 text-left shadow-xl transition-all duration-300 hover:border-[var(--taiko-accent)]"
              style={{
                transform: "skewX(-9deg)",
                background: pl.key === "fav"
                  ? "linear-gradient(150deg, #5c2430 0%, #8a3345 55%, #34141c 100%)"
                  : pl.key === "history"
                    ? "linear-gradient(150deg, #2f4053 0%, #42627a 55%, #202c39 100%)"
                    : CARD_GRADIENTS[i % CARD_GRADIENTS.length],
              }}
            >
              <span className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(10,12,18,0.05), rgba(10,12,18,0.72))" }} />
              <span className="relative z-10 flex h-full w-full min-w-0 flex-col justify-end p-6" style={{ transform: "skewX(9deg)" }}>
                <span className="flex min-w-0 flex-col gap-1">
                  <HorizontalTitle title={pl.name} />
                  <span className="text-xs tabular-nums text-[rgba(255,255,255,0.65)]">
                    {pl.count} {tr("首", pl.count === 1 ? "song" : "songs")}
                  </span>
                </span>
              </span>
            </Button>
          ))}
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="relative z-10 grid h-full min-h-0 w-full grid-cols-[minmax(250px,43%)_minmax(0,1fr)] items-center gap-[clamp(18px,4vw,66px)] px-[clamp(20px,5vw,76px)] pb-3">
            <div className="flex h-[min(92%,650px)] min-h-0 min-w-0 flex-col" style={{ transform: `skewX(${DETAIL_SKEW}deg)` }}>
              <div className="shrink-0 pb-1 pl-8 text-xs font-semibold tracking-[0.18em] text-[rgba(255,255,255,0.62)]" style={{ transform: `skewX(${-DETAIL_SKEW}deg)` }}>
                {activePlaylist?.name ?? ""}
              </div>
              <div
                ref={detailScrollRef}
                onScroll={onDetailScroll}
                className="taiko-detail-scroll min-h-0 flex-1 overflow-y-auto pr-4 pt-[clamp(112px,20vh,160px)]"
              >
                {activeSongs.map((item, index) => {
                  const on = item.id === selectedId;
                  return (
                    <Button
                      key={item.id}
                      data-song-id={item.id}
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        pickSong(item);
                        detailScrollRef.current?.querySelector<HTMLElement>(`[data-song-id="${item.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      className={`mb-2 ml-4 flex h-[clamp(48px,9vh,72px)] flex-col items-stretch justify-center overflow-hidden rounded-sm border-l-4 px-5 text-left shadow-lg transition-[width,transform,background-color,border-color] duration-200 ${
                        on
                          ? "w-[calc(100%-1rem)] -translate-x-3 border-[var(--taiko-accent)] bg-[rgba(245,245,245,0.9)] text-[var(--taiko-paper)]"
                          : "w-[82%] border-[rgba(255,255,255,0.4)] bg-[rgba(15,16,20,0.66)] text-[rgba(255,255,255,0.84)] hover:bg-[rgba(25,26,31,0.82)]"
                      }`}
                      style={{ transform: on ? "translateX(-0.75rem)" : undefined }}
                    >
                      <span className="block min-w-0" style={{ transform: `skewX(${-DETAIL_SKEW}deg)` }}>
                        <span className="flex items-baseline gap-3">
                          <span className={`w-6 shrink-0 text-[11px] tabular-nums ${on ? "text-[var(--taiko-accent)]" : "text-[rgba(255,255,255,0.42)]"}`}>
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="truncate text-sm font-semibold sm:text-base">{item.title}</span>
                        </span>
                        <span className={`ml-9 block truncate text-[10px] ${on ? "text-[rgba(15,12,10,0.62)]" : "text-[rgba(255,255,255,0.48)]"}`}>
                          {item.artist ?? tr("未知艺人", "Unknown artist")}
                        </span>
                      </span>
                    </Button>
                  );
                })}
                <div aria-hidden="true" className="h-[45vh]" />
              </div>
            </div>

            <div className="relative flex h-[min(78%,520px)] min-h-0 min-w-0 items-stretch overflow-hidden border border-[var(--taiko-glass-line-strong)] bg-[var(--taiko-glass-strong)] shadow-2xl backdrop-blur-[18px]" style={{ transform: `skewX(${DETAIL_SKEW}deg)` }}>
              {!selected ? (
                <p className="m-auto text-sm text-[rgba(255,255,255,0.6)]" style={{ transform: `skewX(${-DETAIL_SKEW}deg)` }}>
                  {tr("选择一首歌", "Pick a song")}
                </p>
              ) : (() => {
                const item = selected;
                const busyThis = loadingId === item.id;
                const downloaded = isDl(item);
                const downloading = dl.activeId === item.id;
                const fav = favs.includes(item.id);
                const locked = !isUnlocked(bests, item.id, song.difficulty);
                return (
                  <div key={item.id} className="taiko-scroll relative flex max-h-full w-[calc(100%+5rem)] -translate-x-10 flex-col gap-3 overflow-y-auto px-12 py-5" style={{ transform: `skewX(${-DETAIL_SKEW}deg)` }}>
                    <div className="flex items-start gap-2 border-l-4 border-[var(--taiko-accent)] pl-4">
                      <div className="min-w-0 flex-1">
                        <HorizontalTitle title={item.title} />
                        <span className="block truncate text-xs tabular-nums text-[rgba(255,255,255,0.65)]">
                          {item.artist ? `${item.artist} · ` : ""}
                          {fmtTime(item.durationMs)} · BPM {item.bpm} · {item.timeSignature[0]}/{item.timeSignature[1]}
                          {downloaded ? ` · ${tr("已下载", "Downloaded")}` : ""}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setBoardFor(item)}
                        aria-label={tr("排行榜", "Leaderboard")}
                        className="h-9 shrink-0 gap-1.5 rounded-md border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-3 text-xs text-[rgba(255,255,255,0.8)] hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
                      >
                        <Trophy size={14} />
                        {tr("排行榜", "Ranking")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => toggleFav(item.id)}
                        aria-label={fav ? tr("取消收藏", "Unfavorite") : tr("收藏", "Favorite")}
                        aria-pressed={fav}
                        className="h-9 w-9 shrink-0 rounded-md border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] hover:border-[#ff5a6e]"
                      >
                        <Heart size={17} className={fav ? "fill-[#ff5a6e] text-[#ff5a6e]" : "text-[rgba(255,255,255,0.75)]"} />
                      </Button>
                    </div>
                    <div className="my-1 bg-[rgba(8,8,11,0.42)] px-4 py-3 backdrop-blur-[12px]">
                      <CardControls songId={item.id} bests={bests} />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={() => {
                          if (downloading) cancelDownload();
                          else if (downloaded) void startSong(item);
                          else void downloadSong(item);
                        }}
                        disabled={busyThis || (locked && downloaded)}
                        className="relative h-10 min-w-[7.5rem] gap-2 overflow-hidden rounded-md bg-[var(--taiko-accent)] px-5 text-sm font-semibold tracking-[0.15em] text-[var(--taiko-paper)] transition-transform hover:scale-[1.04] disabled:opacity-60"
                      >
                        {busyThis ? <><Loader2 size={16} className="animate-spin" />{tr("准备中", "Loading")}</>
                          : downloading ? <><X size={16} />{dl.percent}%</>
                            : downloaded ? <><Play size={16} />{tr("开始", "PLAY")}</>
                              : <><Download size={16} />{dl.errorId === item.id ? tr("重试", "Retry") : tr("下载", "Download")}</>}
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      {boardFor && (
        <LeaderboardDialog song={boardFor} difficulty={song.difficulty} onClose={() => setBoardFor(null)} />
      )}
    </div>
  );
}
