/**
 * 谱面屏：五首预设曲，点一首即加载（四条 stem 音轨 + 鼓 MIDI 都在 CDN）。
 * 加载完成后展示 MIDI 的速度/拍号/变速信息，提供偏移微调、播放与节拍器试听，
 * 以及当前难度下的谱面统计预览。
 */
import { useEffect, useMemo, useState } from "react";
import { useSong } from "./songStore";
import { getPlayChart } from "./chartCache";
import { shiftChart } from "@/shared/taikoChart";
import { PRESET_SONGS, loadPresetSong, type PresetSong } from "./presetSongs";
import { songPlayer } from "./player";
import { STEM_KINDS, hasAnyStem, stemsDurationMs, stemsLeadMs } from "./stems";
import { GlobalSettings } from "./GlobalSettings";
import { HelpDot } from "@/components/HelpDot";
import { helpText } from "./helpTexts";
import { useLanguage } from "./i18n";


export function ChartScreen({
  speed,
  onSpeedChange,
}: {
  speed: number;
  onSpeedChange: (s: number) => void;
}) {
  const song = useSong();
  const { tr, language } = useLanguage();

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [ready, setReady] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);

  // ---- 选歌：下载 + 解码，只对外给一个百分比 ----
  const pickSong = async (preset: PresetSong) => {
    if (loadingId) return;
    setWarn(null);
    setReady(false);
    setPercent(0);
    setLoadingId(preset.id);
    songPlayer.stop();
    try {
      const loaded = await loadPresetSong(preset, (p) => setPercent(p));
      // 开头空白长度：播放跳过 + 谱面同步平移，倒计时结束立刻出声
      const leadMs = stemsLeadMs(loaded.stems);
      songPlayer.setLeadMs(leadMs);
      songPlayer.load(loaded.stems);
      for (const kind of STEM_KINDS) songPlayer.setStemGain(kind, song.mix[kind]);
      song.setSong({
        stems: loaded.stems,
        midi: loaded.midi,
        midiFileName: loaded.midiFileName,
        fileName: loaded.title,
        offsetMs: 0,
        phaseBeatOffset: 0,
        bpm: Math.round(loaded.midi.bpm * 100) / 100,
        timeSignature: loaded.midi.timeSignature,
        audioLeadMs: leadMs,
        chart: null,
      });
      setReady(true);
    } catch (err) {
      console.error(err);
      setWarn(tr("加载失败，请检查网络后重试", "Failed to load, check your network and retry"));
    } finally {
      setLoadingId(null);
    }
  };

  const audioDurationMs = Math.max(0, stemsDurationMs(song.stems) - song.audioLeadMs);
  const durationMs = audioDurationMs || (song.midi?.durationMs ?? 0);
  // ---- 谱面预览（按当前难度，与游玩共用同一份固化谱面） ----
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

  const fmtTime = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const songList = (
    <div className="border border-[var(--taiko-line)] px-4 py-3">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-medium">{tr("选择歌曲", "Choose a song")}</span>
        <HelpDot label={tr("选择歌曲", "Choose a song")} text={helpText("song", language)} />
        {ready && !loadingId && (
          <span className="ml-1 text-xs text-emerald-400">{tr("已就绪", "Ready")}</span>
        )}
        {warn && <span className="text-xs text-[var(--taiko-ink)]/60">{warn}</span>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PRESET_SONGS.map((p) => {
          const active = song.fileName === p.title;
          const busyThis = loadingId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => void pickSong(p)}
              disabled={loadingId !== null}
              className={`relative overflow-hidden border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60 ${
                active
                  ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent)]/15 text-[var(--taiko-accent)]"
                  : "border-[var(--taiko-line)] hover:border-[var(--taiko-accent)]"
              }`}
            >
              <span className="relative z-10 flex min-w-0 items-baseline justify-between gap-3">
                <span className="truncate">{p.title}</span>
                {active && !busyThis && (
                  <span className="shrink-0 text-xs tabular-nums text-[var(--taiko-accent)]/80">
                    {fmtTime(durationMs)} · BPM {song.bpm} · {song.timeSignature[0]}/{song.timeSignature[1]}
                  </span>
                )}
              </span>
              <span
                className={`relative z-10 block text-xs tabular-nums ${
                  active ? "text-[var(--taiko-accent)]/80" : "text-[var(--taiko-ink)]/50"
                }`}
              >
                {busyThis
                  ? `${percent}%`
                  : active
                    ? tr("已加载", "Loaded")
                    : tr("点击加载", "Tap to load")}
              </span>
              {busyThis && (
                <span
                  className="absolute inset-y-0 left-0 bg-[var(--taiko-accent)]/25 transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              )}

            </button>
          );
        })}
      </div>
    </div>
  );

  if (!song.midi && !hasAnyStem(song.stems)) {
    return (
      <div className="flex flex-col gap-6">
        <GlobalSettings speed={speed} onSpeedChange={onSpeedChange} />

        {songList}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <GlobalSettings speed={speed} onSpeedChange={onSpeedChange} />
      {songList}
    </div>
  );
}

