/**
 * 谱面屏：五首预设曲，点一首即加载（四条 stem 音轨 + 鼓 MIDI 都在 CDN）。
 * 加载完成后展示 MIDI 的速度/拍号/变速信息，提供偏移微调、播放与节拍器试听，
 * 以及当前难度下的谱面统计预览。
 */
import { useEffect, useMemo, useState } from "react";
import { useSong } from "./songStore";
import { analyzeMidi } from "./difficulty";
import { clearChartCache, getPlayChart } from "./chartCache";
import { DIFFICULTIES } from "./difficulty";
import { countByPart } from "./midiChart";
import { DRUM_PARTS, PART_BY_ID, VISIBLE_PARTS } from "./laneLayouts";
import { layoutOf } from "./difficulty";
import { PRESET_SONGS, loadPresetSong, type PresetSong } from "./presetSongs";
import { songPlayer } from "./player";
import { Metronome } from "./metronome";
import { STEM_KINDS, STEM_LABEL, hasAnyStem, stemsDurationMs } from "./stems";

export function ChartScreen() {
  const song = useSong();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [ready, setReady] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [metroOn, setMetroOn] = useState(false);

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
      songPlayer.load(loaded.stems);
      for (const kind of STEM_KINDS) songPlayer.setStemGain(kind, song.mix[kind]);
      setPlaying(false);
      setPosMs(0);
      setMetroOn(false);
      song.setSong({
        stems: loaded.stems,
        midi: loaded.midi,
        midiFileName: loaded.midiFileName,
        fileName: loaded.title,
        offsetMs: 0,
        phaseBeatOffset: 0,
        bpm: Math.round(loaded.midi.bpm * 100) / 100,
        timeSignature: loaded.midi.timeSignature,
        chart: null,
      });
      setReady(true);
    } catch (err) {
      console.error(err);
      setWarn("加载失败，请检查网络后重试");
    } finally {
      setLoadingId(null);
    }
  };


  const audioDurationMs = stemsDurationMs(song.stems);
  const durationMs = audioDurationMs || (song.midi?.durationMs ?? 0);
  const anyStem = hasAnyStem(song.stems);

  // ---- 谱面预览（按当前难度，与游玩共用同一份固化谱面） ----
  const [chartNonce, setChartNonce] = useState(0);
  const chart = useMemo(() => {
    if (!song.midi) return null;
    return getPlayChart(
      song.midi,
      {
        title: song.fileName,
        offsetMs: song.offsetMs,
        phaseBeatOffset: song.phaseBeatOffset,
      },
      song.difficulty,
    );
    // chartNonce 变化 = 手动「重新生成谱面」
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.midi, song.fileName, song.offsetMs, song.phaseBeatOffset, song.difficulty, chartNonce]);

  const regenerate = () => {
    if (!song.midi) return;
    clearChartCache(song.fileName, song.midi);
    setChartNonce((n) => n + 1);
  };

  useEffect(() => {
    song.setSong({ chart });
    // chart 只随输入变化重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart]);

  const counts = useMemo(() => (chart ? countByPart(chart) : null), [chart]);

  // ---- 拆解结果（小节数 / 相位 / 过门小节） ----
  const analysis = useMemo(
    () => (song.midi ? analyzeMidi(song.midi, song.phaseBeatOffset) : null),
    [song.midi, song.phaseBeatOffset],
  );

  // ---- 播放 ----
  useEffect(() => {
    songPlayer.setOnEnded(() => setPlaying(false));
    return () => songPlayer.setOnEnded(null);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setPosMs(songPlayer.timeMs()), 250);
    return () => window.clearInterval(t);
  }, [playing]);

  const togglePlay = () => {
    if (songPlayer.playing) {
      songPlayer.pause();
      setPlaying(false);
    } else {
      songPlayer.play();
      setPlaying(true);
    }
  };

  // ---- 节拍器 ----
  useEffect(() => {
    if (!metroOn) return;
    const m = new Metronome();
    m.start({
      bpm: song.bpm,
      beatsPerBar: song.timeSignature[0] * (4 / song.timeSignature[1]),
      offsetMs: song.offsetMs,
      getPositionMs: () => (songPlayer.playing ? songPlayer.timeMs() : null),
    });
    return () => m.stop();
  }, [metroOn, song.bpm, song.timeSignature, song.offsetMs]);

  const fmtTime = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const songList = (
    <div className="border border-[var(--taiko-line)] px-4 py-3">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm font-medium">选择歌曲</span>
        {ready && !loadingId && <span className="text-xs text-emerald-400">已就绪</span>}
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
                  ? "border-[var(--taiko-ink)] bg-[var(--taiko-ink)]/10"
                  : "border-[var(--taiko-line)] hover:border-[var(--taiko-ink)]"
              }`}
            >
              <span className="relative z-10 block truncate">{p.title}</span>
              <span className="relative z-10 block text-xs tabular-nums text-[var(--taiko-ink)]/50">
                {busyThis ? `${percent}%` : active ? "已加载" : "点击加载"}
              </span>
              {busyThis && (
                <span
                  className="absolute inset-y-0 left-0 bg-[var(--taiko-ink)]/15 transition-[width] duration-200"
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
    return <div className="flex flex-col gap-6">{songList}</div>;
  }

  const tempoChanges = song.midi ? Math.max(0, song.midi.tempos.length - 1) : 0;

  return (
    <div className="flex flex-col gap-6">
      {songList}

      {/* 当前歌曲信息 */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-[var(--taiko-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{song.fileName || "未命名"}</div>
          <div className="text-xs tabular-nums text-[var(--taiko-ink)]/50">
            {fmtTime(durationMs)}
            {anyStem ? "" : " · 无音频（静音试玩）"}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs">
          {STEM_KINDS.map((k) => {
            const t = song.stems[k];
            return (
              <span
                key={k}
                className={t ? "text-[var(--taiko-ink)]/70" : "text-[var(--taiko-ink)]/30"}
              >
                {STEM_LABEL[k]}：{t ? "已就绪" : "无"}
              </span>
            );
          })}
        </div>
      </div>


      {/* MIDI 拆解结果 */}
      {analysis && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-[var(--taiko-line)] px-4 py-3 text-xs text-[var(--taiko-ink)]/70">
          <span className="font-medium text-[var(--taiko-ink)]">MIDI 拆解</span>
          <span className="tabular-nums">量化后 {analysis.clean.hits.length} 击</span>
          <span className="tabular-nums">{analysis.skeleton.bars.length} 小节</span>
          <span className="tabular-nums">
            过门 {analysis.skeleton.bars.filter((b) => b.isFill).length} 小节
          </span>
          <span className="tabular-nums">
            小节相位 {analysis.clean.phaseSteps / analysis.clean.stepsPerBeat} 拍
          </span>
          <span className="flex items-center gap-1">
            微调
            <button
              onClick={() => song.setSong({ phaseBeatOffset: song.phaseBeatOffset - 1 })}
              className="border border-[var(--taiko-line)] px-2 py-0.5 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
            >
              −1 拍
            </button>
            <button
              onClick={() => song.setSong({ phaseBeatOffset: song.phaseBeatOffset + 1 })}
              className="border border-[var(--taiko-line)] px-2 py-0.5 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
            >
              +1 拍
            </button>
            {song.phaseBeatOffset !== 0 && (
              <button
                onClick={() => song.setSong({ phaseBeatOffset: 0 })}
                className="px-1 underline decoration-dotted"
              >
                复位（{song.phaseBeatOffset > 0 ? "+" : ""}
                {song.phaseBeatOffset}）
              </button>
            )}
          </span>
        </div>
      )}

      {/* 速度 / 拍号（来自 MIDI）+ 偏移 + 试听 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border border-[var(--taiko-line)] px-4 py-3">
        <span className="text-xs tabular-nums text-[var(--taiko-ink)]/70">
          BPM {song.bpm}
          {tempoChanges > 0 ? ` · ${tempoChanges} 处变速` : ""}
        </span>
        <span className="text-xs tabular-nums text-[var(--taiko-ink)]/70">
          拍号 {song.timeSignature[0]}/{song.timeSignature[1]}
        </span>
        <span className="text-xs text-[var(--taiko-ink)]/45">来自 MIDI tempo map</span>

        <label className="flex items-center gap-2 text-xs text-[var(--taiko-ink)]/60">
          对齐偏移 ms
          <input
            type="number"
            step={10}
            value={Math.round(song.offsetMs)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) song.setSong({ offsetMs: v });
            }}
            className="w-24 border border-[var(--taiko-line)] bg-transparent px-2 py-1 text-sm tabular-nums text-[var(--taiko-ink)]"
          />
        </label>

        <span className="mx-1 h-5 w-px bg-[var(--taiko-line)]" />
        <button
          onClick={togglePlay}
          disabled={!anyStem}
          className="border border-[var(--taiko-ink)] px-4 py-1.5 text-xs text-[var(--taiko-ink)] transition-colors hover:bg-[var(--taiko-ink)] hover:text-[var(--taiko-paper)] disabled:opacity-30"
        >
          {playing ? "暂停" : "播放"}
        </button>
        <span className="text-xs tabular-nums text-[var(--taiko-ink)]/55">
          {fmtTime(playing ? posMs : songPlayer.timeMs())} / {fmtTime(durationMs)}
        </span>
        <button
          onClick={() => setMetroOn((v) => !v)}
          className={`border px-4 py-1.5 text-xs transition-colors ${
            metroOn
              ? "border-[var(--taiko-ink)] bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
              : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/70 hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
          }`}
        >
          节拍器 {metroOn ? "开" : "关"}
        </button>
      </div>

      {/* 难度 + 谱面统计 */}
      <section className="flex flex-col gap-3 border border-[var(--taiko-line)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-sm font-medium">难度</h2>
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              onClick={() => song.setSong({ difficulty: d.id })}
              className={`-ml-px border border-[var(--taiko-line)] px-3 py-1.5 text-xs transition-colors first:ml-0 ${
                song.difficulty === d.id
                  ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                  : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
              }`}
            >
              {d.label}
            </button>
          ))}
          <span className="text-xs text-[var(--taiko-ink)]/45">
            {DIFFICULTIES.find((d) => d.id === song.difficulty)?.hint}
          </span>
          <span className="ml-auto text-xs tabular-nums text-[var(--taiko-ink)]/60">
            {chart ? `${chart.notes.length} 音符` : "缺少 MIDI，无法生成谱面"}
          </span>
          {song.midi && (
            <button
              onClick={regenerate}
              title="谱面按歌曲固化，只有点这里才会重算"
              className="border border-[var(--taiko-line)] px-3 py-1.5 text-xs text-[var(--taiko-ink)]/60 transition-colors hover:text-[var(--taiko-ink)]"
            >
              重新生成谱面
            </button>
          )}
        </div>

        {counts && (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {DRUM_PARTS.filter((p) => VISIBLE_PARTS[layoutOf(song.difficulty)].includes(p.id)).map(
              (p) => (
                <span
                  key={p.id}
                  className="flex items-center gap-2 text-xs tabular-nums text-[var(--taiko-ink)]/70"
                >
                  <i
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: PART_BY_ID[p.id].color }}
                  />
                  {p.label} {counts[p.id]}
                </span>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
