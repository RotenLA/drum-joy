/**
 * 谱面屏：歌曲来自云端曲库（后台上传），点一首即下载分轨音频 + 鼓 MIDI。
 * 谱面直接取后台预生成的四档固化谱面，保证所有人打的是同一份谱。
 * 「选择歌曲 / 历史演奏」两个标签页，歌曲列表支持搜索。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSong } from "./songStore";
import { getPlayChart } from "./chartCache";
import { shiftChart } from "@/shared/taikoChart";
import { fetchLibrarySongs, loadLibrarySong, type LibrarySong } from "./songLibrary";
import { songPlayer } from "./player";
import { STEM_KINDS, hasAnyStem, stemsDurationMs, stemsLeadMs } from "./stems";
import { GlobalSettings } from "./GlobalSettings";
import { HelpDot } from "@/components/HelpDot";
import { helpText } from "./helpTexts";
import { useLanguage } from "./i18n";
import { clearHistory, readHistory, type HistoryEntry } from "./history";
import { DIFFICULTIES, type Difficulty } from "./difficulty";

const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function ChartScreen({
  speed,
  onSpeedChange,
}: {
  speed: number;
  onSpeedChange: (s: number) => void;
}) {
  const song = useSong();
  const { tr, language } = useLanguage();

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
    // 只在挂载时拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 选歌：下载 + 解码，只对外给一个百分比 ----
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
        if (spd) onSpeedChange(spd);
        setReady(true);
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

  const audioDurationMs = Math.max(0, stemsDurationMs(song.stems) - song.audioLeadMs);
  const durationMs = audioDurationMs || (song.midi?.durationMs ?? 0);

  // ---- 谱面（与游玩共用同一份固化/云端谱面） ----
  const chart = useMemo(() => {
    if (!song.midi) return null;
    return shiftChart(
      getPlayChart(
        song.midi,
        {
          title: song.fileName,
          offsetMs: song.offsetMs,
          phaseBeatOffset: song.phaseBeatOffset,
        },
        song.difficulty,
      ),
      song.audioLeadMs,
    );
  }, [
    song.midi,
    song.fileName,
    song.offsetMs,
    song.phaseBeatOffset,
    song.difficulty,
    song.audioLeadMs,
  ]);

  useEffect(() => {
    song.setSong({ chart });
    // chart 只随输入变化重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return library;
    return library.filter(
      (s) => s.title.toLowerCase().includes(q) || (s.artist ?? "").toLowerCase().includes(q),
    );
  }, [library, query]);

  const diffLabel = (d: Difficulty) => {
    const item = DIFFICULTIES.find((x) => x.id === d);
    if (!item) return d;
    return tr(item.label, item.labelEn);
  };

  const songCards = (
    <div className="grid gap-3 sm:grid-cols-2">
      {filtered.map((item) => {
        const active = song.songId === item.id;
        const busyThis = loadingId === item.id;
        return (
          <button
            key={item.id}
            onClick={() => void pickSong(item)}
            disabled={loadingId !== null}
            className={`relative overflow-hidden border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
              active
                ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent-soft)]"
                : "border-[var(--taiko-line)] hover:border-[var(--taiko-accent)]"
            }`}
          >
            {active && (
              <span className="absolute inset-y-0 left-0 w-1 bg-[var(--taiko-accent)]" />
            )}
            {busyThis && (
              <span
                className="absolute inset-y-0 left-0 bg-[var(--taiko-accent-progress)] transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            )}
            <span className="relative z-10 flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span
                  className={`block truncate text-base font-medium ${
                    active ? "text-[var(--taiko-accent)]" : ""
                  }`}
                >
                  {item.title}
                </span>
                <span
                  className={`mt-1 block truncate text-xs tabular-nums ${
                    active ? "text-[var(--taiko-accent-2)]" : "text-[var(--taiko-ink)]/55"
                  }`}
                >
                  {item.artist ? `${item.artist} · ` : ""}
                  {fmtTime(active ? durationMs || item.durationMs : item.durationMs)} · BPM{" "}
                  {active ? song.bpm : item.bpm} ·{" "}
                  {active
                    ? `${song.timeSignature[0]}/${song.timeSignature[1]}`
                    : `${item.timeSignature[0]}/${item.timeSignature[1]}`}
                </span>
              </span>
              <span
                className={`shrink-0 border px-2 py-0.5 text-xs tabular-nums ${
                  active
                    ? "border-[var(--taiko-accent)] text-[var(--taiko-accent)]"
                    : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/50"
                }`}
              >
                {busyThis
                  ? `${percent}%`
                  : active
                    ? tr("已加载", "Loaded")
                    : tr("点击加载", "Load")}
              </span>
            </span>
          </button>
        );
      })}
      {!filtered.length && !listing && (
        <p className="py-8 text-center text-xs text-[var(--taiko-ink)]/50 sm:col-span-2">
          {library.length
            ? tr("没有匹配的歌曲", "No matching songs")
            : tr("曲库还没有歌曲", "The library is empty")}
        </p>
      )}
      {listing && (
        <p className="py-8 text-center text-xs text-[var(--taiko-ink)]/50 sm:col-span-2">
          {tr("正在读取曲库…", "Loading library…")}
        </p>
      )}
    </div>
  );

  const historyList = (
    <div className="flex flex-col">
      {history.length > 0 && (
        <button
          onClick={() => {
            clearHistory();
            setHistory([]);
          }}
          className="mb-3 self-end border border-[var(--taiko-line)] px-2 py-1 text-xs text-[var(--taiko-ink)]/60 hover:border-[var(--taiko-accent)]"
        >
          {tr("清空记录", "Clear")}
        </button>
      )}
      <div className="flex flex-col divide-y divide-[var(--taiko-line)]">
        {history.map((h, i) => {
          const item = library.find((s) => s.id === h.songId);
          return (
            <button
              key={`${h.playedAt}-${i}`}
              onClick={() => {
                if (item) void pickSong(item, h.difficulty, h.speed);
              }}
              disabled={!item || loadingId !== null}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-left text-sm disabled:opacity-50 hover:text-[var(--taiko-accent)]"
            >
              <span className="min-w-0 truncate">{h.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-[var(--taiko-ink)]/55">
                {diffLabel(h.difficulty)} · {h.speed}x ·{" "}
                {tr("准确率", "Acc")} {(h.accuracy ?? 0).toFixed(1)}% ·{" "}
                {tr("连击", "Combo")} {h.maxCombo ?? 0} ·{" "}
                {new Date(h.playedAt).toLocaleString()}
              </span>
            </button>
          );
        })}
        {!history.length && (
          <p className="py-8 text-center text-xs text-[var(--taiko-ink)]/50">
            {tr("还没有演奏记录", "No plays yet")}
          </p>
        )}
      </div>
    </div>
  );

  const panel = (
    <div className="border border-[var(--taiko-line)] px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(
          [
            ["songs", tr("选择歌曲", "Choose a song")],
            ["history", tr("历史演奏", "Play history")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`border px-3 py-1.5 text-sm transition-colors ${
              tab === id
                ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent-soft)] text-[var(--taiko-accent)]"
                : "border-[var(--taiko-line)] hover:border-[var(--taiko-accent)]"
            }`}
          >
            {label}
          </button>
        ))}
        <HelpDot label={tr("选择歌曲", "Choose a song")} text={helpText("song", language)} />
        {ready && !loadingId && (
          <span className="ml-1 text-xs text-emerald-400">{tr("已就绪", "Ready")}</span>
        )}
        {(warn || listErr) && (
          <span className="text-xs text-[var(--taiko-ink)]/60">{warn ?? listErr}</span>
        )}
      </div>

      {tab === "songs" ? (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("搜索歌名或艺人", "Search title or artist")}
            className="mb-3 w-full border border-[var(--taiko-line)] bg-transparent px-3 py-2 text-base text-[var(--taiko-ink)] outline-none focus:border-[var(--taiko-accent)]"
          />
          {songCards}
        </>
      ) : (
        historyList
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <GlobalSettings speed={speed} onSpeedChange={onSpeedChange} />
      {panel}
    </div>
  );
}
