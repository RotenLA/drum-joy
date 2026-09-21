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
import { shiftChart } from "@/shared/taikoChart";
import { DRUM_PARTS, PART_BY_ID, VISIBLE_PARTS, partLabel } from "./laneLayouts";
import { layoutOf } from "./difficulty";
import { PRESET_SONGS, loadPresetSong, type PresetSong } from "./presetSongs";
import { songPlayer } from "./player";
import { Metronome } from "./metronome";
import { STEM_KINDS, STEM_LABEL, hasAnyStem, stemsDurationMs, stemsLeadMs } from "./stems";
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
      // 开头空白长度：播放跳过 + 谱面同步平移，倒计时结束立刻出声
      const leadMs = stemsLeadMs(loaded.stems);
      songPlayer.setLeadMs(leadMs);
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
  const anyStem = hasAnyStem(song.stems);

  // ---- 谱面预览（按当前难度，与游玩共用同一份固化谱面） ----
  const [chartNonce, setChartNonce] = useState(0);
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
    // chartNonce 变化 = 手动「重新生成谱面」
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    song.midi,
    song.fileName,
    song.offsetMs,
    song.phaseBeatOffset,
    song.difficulty,
    song.audioLeadMs,
    chartNonce,
  ]);

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
                  ? "border-[var(--taiko-ink)] bg-[var(--taiko-ink)]/10"
                  : "border-[var(--taiko-line)] hover:border-[var(--taiko-ink)]"
              }`}
            >
              <span className="relative z-10 block truncate">{p.title}</span>
              <span className="relative z-10 block text-xs tabular-nums text-[var(--taiko-ink)]/50">
                {busyThis
                  ? `${percent}%`
                  : active
                    ? tr("已加载", "Loaded")
                    : tr("点击加载", "Tap to load")}
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
    return (
      <div className="flex flex-col gap-6">
        <GlobalSettings speed={speed} onSpeedChange={onSpeedChange} />
        {songList}
      </div>
    );
  }

  const tempoChanges = song.midi ? Math.max(0, song.midi.tempos.length - 1) : 0;

  return (
    <div className="flex flex-col gap-6">
      <GlobalSettings speed={speed} onSpeedChange={onSpeedChange} />
      {songList}

      {/* 当前歌曲信息 */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-[var(--taiko-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {song.fileName || tr("未命名", "Untitled")}
          </div>
          <div className="text-xs tabular-nums text-[var(--taiko-ink)]/50">
            {fmtTime(durationMs)}
            {anyStem ? "" : tr(" · 无音频（静音试玩）", " · No audio (silent practice)")}
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
                {STEM_LABEL[k]}：{t ? tr("已就绪", "Ready") : tr("无", "None")}
              </span>
            );
          })}
        </div>
      </div>

      {/* MIDI 拆解结果 */}
      {analysis && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-[var(--taiko-line)] px-4 py-3 text-xs text-[var(--taiko-ink)]/70">
          <span className="font-medium text-[var(--taiko-ink)]">
            {tr("MIDI 拆解", "MIDI breakdown")}
          </span>
          <span className="tabular-nums">
            {tr(`量化后 ${analysis.clean.hits.length} 击`, `${analysis.clean.hits.length} hits after quantizing`)}
          </span>
          <span className="tabular-nums">
            {tr(`${analysis.skeleton.bars.length} 小节`, `${analysis.skeleton.bars.length} bars`)}
          </span>
          <span className="tabular-nums">
            {tr(
              `过门 ${analysis.skeleton.bars.filter((b) => b.isFill).length} 小节`,
              `${analysis.skeleton.bars.filter((b) => b.isFill).length} fill bars`,
            )}
          </span>
          <span className="tabular-nums">
            {tr(
              `小节相位 ${analysis.clean.phaseSteps / analysis.clean.stepsPerBeat} 拍`,
              `Bar phase ${analysis.clean.phaseSteps / analysis.clean.stepsPerBeat} beats`,
            )}
          </span>
          <span className="flex items-center gap-1">
            {tr("微调", "Adjust")}
            <HelpDot label={tr("小节相位微调", "Bar phase adjust")} text={helpText("phase", language)} />
            <button
              onClick={() => song.setSong({ phaseBeatOffset: song.phaseBeatOffset - 1 })}
              className="border border-[var(--taiko-line)] px-2 py-0.5 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
            >
              {tr("−1 拍", "−1 beat")}
            </button>
            <button
              onClick={() => song.setSong({ phaseBeatOffset: song.phaseBeatOffset + 1 })}
              className="border border-[var(--taiko-line)] px-2 py-0.5 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
            >
              {tr("+1 拍", "+1 beat")}
            </button>
            {song.phaseBeatOffset !== 0 && (
              <button
                onClick={() => song.setSong({ phaseBeatOffset: 0 })}
                className="px-1 underline decoration-dotted"
              >
                {tr(
                  `复位（${song.phaseBeatOffset > 0 ? "+" : ""}${song.phaseBeatOffset}）`,
                  `Reset (${song.phaseBeatOffset > 0 ? "+" : ""}${song.phaseBeatOffset})`,
                )}
              </button>
            )}
          </span>
        </div>
      )}

      {/* 速度 / 拍号（来自 MIDI）+ 偏移 + 试听 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border border-[var(--taiko-line)] px-4 py-3">
        <span className="text-xs tabular-nums text-[var(--taiko-ink)]/70">
          BPM {song.bpm}
          {tempoChanges > 0 ? tr(` · ${tempoChanges} 处变速`, ` · ${tempoChanges} tempo changes`) : ""}
        </span>
        <span className="text-xs tabular-nums text-[var(--taiko-ink)]/70">
          {tr("拍号", "Time sig")} {song.timeSignature[0]}/{song.timeSignature[1]}
        </span>
        <span className="text-xs text-[var(--taiko-ink)]/45">
          {tr("来自 MIDI tempo map", "From MIDI tempo map")}
        </span>

        <label className="flex items-center gap-2 text-xs text-[var(--taiko-ink)]/60">
          {tr("对齐偏移 ms", "Align offset ms")}
          <HelpDot label={tr("对齐偏移", "Align offset")} text={helpText("offset", language)} />
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
          {playing ? tr("暂停", "Pause") : tr("播放", "Play")}
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
          {tr("节拍器", "Metronome")} {metroOn ? tr("开", "On") : tr("关", "Off")}
        </button>
        <HelpDot label={tr("节拍器", "Metronome")} text={helpText("metronome", language)} />
      </div>

      {/* 难度 + 谱面统计 */}
      <section className="flex flex-col gap-3 border border-[var(--taiko-line)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-1 text-sm font-medium">{tr("难度", "Difficulty")}</h2>
          <HelpDot label={tr("难度", "Difficulty")} text={helpText("difficulty", language)} />
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
              {tr(d.label, d.labelEn)}
            </button>
          ))}
          <span className="text-xs text-[var(--taiko-ink)]/45">
            {(() => {
              const d = DIFFICULTIES.find((d) => d.id === song.difficulty);
              return d ? tr(d.hint, d.hintEn) : "";
            })()}
          </span>
          <span className="ml-auto text-xs tabular-nums text-[var(--taiko-ink)]/60">
            {chart
              ? tr(`${chart.notes.length} 音符`, `${chart.notes.length} notes`)
              : tr("缺少 MIDI，无法生成谱面", "No MIDI, cannot generate chart")}
          </span>
          {song.midi && (
            <button
              onClick={regenerate}
              title={tr(
                "谱面按歌曲固化，只有点这里才会重算",
                "Charts are fixed per song; tap here to recompute",
              )}
              className="border border-[var(--taiko-line)] px-3 py-1.5 text-xs text-[var(--taiko-ink)]/60 transition-colors hover:text-[var(--taiko-ink)]"
            >
              {tr("重新生成谱面", "Regenerate chart")}
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
                  {partLabel(p, language)} {counts[p.id]}
                </span>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
