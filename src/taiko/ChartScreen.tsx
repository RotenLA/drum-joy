/**
 * 谱面屏：导入一组 stem（xxx_Vocals/_Bass/_Drums/_Other.mp3）+ 鼓 MIDI（xxx.mid），
 * 同主文件名自动配对；展示 MIDI 的速度/拍号/变速信息，提供偏移微调、播放与节拍器试听，
 * 以及当前难度下的谱面统计预览。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSong } from "./songStore";
import { parseMidi, type ParsedMidi } from "./midiFile";
import { analyzeMidi } from "./difficulty";
import { clearChartCache, getPlayChart } from "./chartCache";
import { DIFFICULTIES } from "./difficulty";
import { countByPart } from "./midiChart";
import { DRUM_PARTS, PART_BY_ID, VISIBLE_PARTS } from "./laneLayouts";
import { layoutOf } from "./difficulty";
import { loadSampleSong, SAMPLE_TITLE } from "./sampleSong";
import { songPlayer } from "./player";
import { Metronome, getAudioContext } from "./metronome";
import {
  STEM_KINDS,
  STEM_LABEL,
  baseOfMidiName,
  emptyStems,
  hasAnyStem,
  parseStemName,
  peakOf,
  stemsDurationMs,
  type StemMap,
} from "./stems";

const AUDIO_RE = /\.(mp3|wav|m4a|ogg|flac)$/i;
const MIDI_RE = /\.(mid|midi)$/i;

export function ChartScreen() {
  const song = useSong();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [metroOn, setMetroOn] = useState(false);

  // ---- 导入：按 stem 后缀分轨，MIDI 单独收，主文件名配对 ----
  const importFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const audioFiles = files.filter((f) => AUDIO_RE.test(f.name));
    const midiFile = files.find((f) => MIDI_RE.test(f.name)) ?? null;
    if (audioFiles.length === 0 && !midiFile) {
      setWarn("只支持 mp3 / wav 等音频与 mid / midi 文件");
      return;
    }
    setWarn(null);
    setBusy("读取文件…");
    try {
      let midi: ParsedMidi | null = song.midi;
      let midiFileName = song.midiFileName;
      const stems: StemMap = { ...song.stems };
      const bases = new Set<string>();

      if (midiFile) {
        setBusy("解析 MIDI…");
        midi = parseMidi(await midiFile.arrayBuffer());
        midiFileName = midiFile.name;
        bases.add(baseOfMidiName(midiFile.name));
      } else if (midiFileName) {
        bases.add(baseOfMidiName(midiFileName));
      }

      // 新导入一组音轨时，先清掉旧的音轨，避免混入上一首
      if (audioFiles.length > 0) {
        const fresh = emptyStems();
        for (const k of STEM_KINDS) fresh[k] = null;
        Object.assign(stems, fresh);
      }

      for (const f of audioFiles) {
        const { base, kind } = parseStemName(f.name);
        bases.add(base);
        setBusy(`解码 ${STEM_LABEL[kind]}…`);
        const buffer = await getAudioContext().decodeAudioData(await f.arrayBuffer());
        stems[kind] = { buffer, fileName: f.name, peak: peakOf(buffer) };
      }

      const baseList = [...bases].filter(Boolean);
      const base = baseList[0] ?? song.fileName;
      if (baseList.length > 1) {
        setWarn(`文件名主名不一致：${baseList.join(" / ")}，仍按当前组合使用`);
      }

      // 时长一致性校验（stem 应对齐首尾）
      const durations = STEM_KINDS.map((k) => stems[k]?.buffer.duration).filter(
        (d): d is number => typeof d === "number",
      );
      if (durations.length > 1) {
        const spread = Math.max(...durations) - Math.min(...durations);
        if (spread > 0.15) {
          setWarn(`各音轨时长相差 ${spread.toFixed(2)}s，可能未对齐首尾`);
        }
      }

      songPlayer.load(stems);
      songPlayer.setStemGain("vocals", song.mix.vocals);
      songPlayer.setStemGain("drums", song.mix.drums);
      setPlaying(false);
      setPosMs(0);
      setMetroOn(false);
      song.setSong({
        stems,
        midi,
        midiFileName,
        fileName: base,
        offsetMs: 0,
        phaseBeatOffset: 0,
        bpm: midi ? Math.round(midi.bpm * 100) / 100 : 120,
        timeSignature: midi ? midi.timeSignature : [4, 4],
        chart: null,
      });
    } catch (err) {
      console.error(err);
      window.alert("导入失败：无法解析该文件（音频需可解码，MIDI 需为标准 SMF）");
    } finally {
      setBusy(null);
    }
  };

  // ---- 内置示例曲 ----
  const importSample = async () => {
    setWarn(null);
    setBusy("载入示例曲…");
    try {
      const sample = await loadSampleSong((label) => setBusy(label));
      songPlayer.load(sample.stems);
      songPlayer.setStemGain("vocals", song.mix.vocals);
      songPlayer.setStemGain("drums", song.mix.drums);
      setPlaying(false);
      setPosMs(0);
      setMetroOn(false);
      song.setSong({
        stems: sample.stems,
        midi: sample.midi,
        midiFileName: sample.midiFileName,
        fileName: sample.title,
        offsetMs: 0,
        phaseBeatOffset: 0,
        bpm: Math.round(sample.midi.bpm * 100) / 100,
        timeSignature: sample.midi.timeSignature,
        chart: null,
      });
    } catch (err) {
      console.error(err);
      window.alert("示例曲载入失败，请检查网络后重试");
    } finally {
      setBusy(null);
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

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept=".mp3,.wav,.m4a,.ogg,.flac,.mid,.midi,audio/*"
      className="hidden"
      onChange={(e) => {
        const list = Array.from(e.target.files ?? []);
        if (list.length > 0) void importFiles(list);
        e.target.value = "";
      }}
    />
  );

  // ---- 空态：拖放区 ----
  if (!song.midi && !anyStem) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void importFiles(Array.from(e.dataTransfer.files ?? []));
        }}
        className={`flex h-64 flex-col items-center justify-center gap-3 border border-dashed transition-colors ${
          dragOver
            ? "border-[var(--taiko-ink)] bg-[var(--taiko-ink)]/5"
            : "border-[var(--taiko-line)]"
        }`}
      >
        <p className="text-sm text-[var(--taiko-ink)]/70">
          把这首歌的 stem 音轨和鼓 MIDI 一起拖到这里
        </p>
        <p className="text-xs text-[var(--taiko-ink)]/45">
          xxx_Vocals / _Bass / _Drums / _Other.mp3（可缺）+ xxx.mid（必需）
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="border border-[var(--taiko-ink)] px-6 py-2 text-sm text-[var(--taiko-ink)] transition-colors hover:bg-[var(--taiko-ink)] hover:text-[var(--taiko-paper)]"
          >
            选择文件
          </button>
          <button
            onClick={() => void importSample()}
            disabled={busy !== null}
            className="border border-[var(--taiko-line)] px-6 py-2 text-sm text-[var(--taiko-ink)]/70 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)] disabled:opacity-40"
          >
            载入示例曲：{SAMPLE_TITLE}
          </button>
        </div>
        {busy && <p className="text-xs text-[var(--taiko-ink)]/50">{busy}</p>}
        {warn && <p className="text-xs text-[var(--taiko-ink)]/60">{warn}</p>}
        {fileInput}
      </div>
    );
  }

  const tempoChanges = song.midi ? Math.max(0, song.midi.tempos.length - 1) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* 配对信息 */}
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
                {STEM_LABEL[k]}：{t ? t.fileName : "未导入"}
              </span>
            );
          })}
          <span
            className={
              song.midiFileName ? "text-[var(--taiko-ink)]/70" : "text-[var(--taiko-ink)]/35"
            }
          >
            MIDI：{song.midiFileName || "未导入（无法生成谱面）"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void importSample()}
            disabled={busy !== null}
            className="border border-[var(--taiko-line)] px-3 py-1.5 text-xs text-[var(--taiko-ink)]/70 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)] disabled:opacity-40"
          >
            示例曲
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="border border-[var(--taiko-line)] px-3 py-1.5 text-xs text-[var(--taiko-ink)]/70 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
          >
            导入 / 补充文件
          </button>
        </div>
        {busy && <span className="text-xs text-[var(--taiko-ink)]/50">{busy}</span>}
        {warn && <span className="text-xs text-[var(--taiko-ink)]/60">{warn}</span>}
        {fileInput}
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
