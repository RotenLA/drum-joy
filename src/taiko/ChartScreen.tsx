import { useEffect, useMemo, useRef, useState } from "react";
import { measureDurationMs, splitByMeasure } from "@/shared/taikoChart";
import { useSong } from "./songStore";
import { parseAudioMeta } from "./audioMeta";
import { detectBeat } from "./beatDetect";
import {
  BAND_LABEL,
  BAND_NOTE,
  analyzeDrums,
  type DrumBand,
  type DrumSegment,
} from "./drumAnalyze";
import { arrangeChart } from "./arrange";
import { GROOVE_BY_ID, GROOVE_PATTERNS } from "./groovePatterns";
import { matchGroove, scoreGrooves } from "./grooveMatch";
import { DENSITY_LABEL, type Density } from "./chartSimplify";
import { PART_BY_ID } from "./laneLayouts";
import type { LayoutMode } from "./laneLayouts";
import { songPlayer } from "./player";
import { Metronome, getAudioContext } from "./metronome";

const TIME_SIGS: readonly [number, number][] = [
  [2, 4],
  [3, 4],
  [4, 4],
  [6, 8],
];

export function ChartScreen({ layout }: { layout: LayoutMode }) {
  const song = useSong();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 段落 / 主体 / 来源标签存于 songStore：切屏卸载组件后不丢失
  const segments = song.segments;
  const metaSource = song.metaSource;
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [metroOn, setMetroOn] = useState(false);
  const [selMeasure, setSelMeasure] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const chart = song.chart;

  // ---- 导入：解码 → 元数据 → 自动检测 → 鼓节奏分析 ----
  const importFile = async (file: File) => {
    setBusy("解码音频…");
    try {
      const arrayBuf = await file.arrayBuffer();
      const meta = parseAudioMeta(arrayBuf);
      const audioBuffer = await getAudioContext().decodeAudioData(arrayBuf.slice(0));
      songPlayer.load(audioBuffer);
      setPlaying(false);
      setPosMs(0);
      setMetroOn(false);
      setSelMeasure(0);
      const fileName = meta.title || file.name.replace(/\.[^.]+$/, "");
      song.setSong({
        audioBuffer,
        fileName,
        chart: null,
        segments: [],
        primarySegmentId: null,
        grooveId: null,
        barActivity: [],
        barBands: [],
        activeRange: null,
        metaSource: null,
      });

      setBusy("检测速度与拍号…");
      const det = await detectBeat(audioBuffer);
      const bpm = meta.bpm ?? det.bpm;
      const timeSignature = meta.timeSignature ?? det.timeSignature;
      song.setSong({
        bpm,
        timeSignature,
        offsetMs: det.offsetMs,
        metaSource: meta.bpm || meta.timeSignature ? "metadata" : "detect",
      });

      setBusy("分析鼓节奏…");
      const analysis = await analyzeDrums(audioBuffer, bpm, det.offsetMs, timeSignature);
      const primary = analysis.segments[0] ?? null;
      song.setSong({
        segments: analysis.segments,
        primarySegmentId: primary?.id ?? null,
        grooveId: matchGroove(primary, bpm).id,
        barActivity: analysis.barActivity,
        barBands: analysis.barBands,
        activeRange: analysis.activeRange,
        chart: analysis.segments.length === 0 ? null : song.chart,
      });
    } catch (err) {
      console.error(err);
      window.alert("导入失败：无法解码该音频文件");
    } finally {
      setBusy(null);
    }
  };

  const reanalyze = async () => {
    if (!song.audioBuffer) return;
    setBusy("按当前 BPM/拍号重新分析…");
    try {
      const analysis = await analyzeDrums(
        song.audioBuffer,
        song.bpm,
        song.offsetMs,
        song.timeSignature,
      );
      const primary = analysis.segments[0] ?? null;
      song.setSong({
        segments: analysis.segments,
        primarySegmentId: primary?.id ?? null,
        grooveId: matchGroove(primary, song.bpm).id,
        barActivity: analysis.barActivity,
        barBands: analysis.barBands,
        activeRange: analysis.activeRange,
      });
    } finally {
      setBusy(null);
    }
  };

  const primarySegment = useMemo(
    () => segments.find((s) => s.id === song.primarySegmentId) ?? null,
    [segments, song.primarySegmentId],
  );
  /** 主体段落 → 基础节奏型排序（前几名给出推荐标记） */
  const grooveRanking = useMemo(
    () => scoreGrooves(primarySegment, song.bpm),
    [primarySegment, song.bpm],
  );
  const groove =
    (song.grooveId ? GROOVE_BY_ID[song.grooveId] : undefined) ??
    grooveRanking[0]?.pattern ??
    GROOVE_PATTERNS[0]!;

  /** 选主体 / 改基础型 / 改档位 / 改速度拍号 / 改分区 → 重建预览谱面 */
  useEffect(() => {
    if (!song.audioBuffer || segments.length === 0) return;
    const next = arrangeChart({
      groove,
      barActivity: song.barActivity,
      barBands: song.barBands,
      activeRange: song.activeRange,
      layout,
      density: song.density,
      bpm: song.bpm,
      offsetMs: song.offsetMs,
      timeSignature: song.timeSignature,
      durationMs: song.audioBuffer.duration * 1000,
      title: song.fileName,
    });
    song.setSong({ chart: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segments,
    groove,
    song.density,
    song.barActivity,
    song.barBands,
    song.activeRange,
    song.bpm,
    song.timeSignature,
    song.offsetMs,
    song.audioBuffer,
    song.fileName,
    layout,
  ]);

  // ---- 播放（真实音频） ----
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

  // ---- 节拍器（可单独试听，也可叠在歌曲上验证速度） ----
  useEffect(() => {
    if (!metroOn || !song.audioBuffer) return;
    const m = new Metronome();
    m.start({
      bpm: song.bpm,
      beatsPerBar: song.timeSignature[0] * (4 / song.timeSignature[1]),
      offsetMs: song.offsetMs,
      getPositionMs: () => (songPlayer.playing ? songPlayer.timeMs() : null),
    });
    return () => m.stop();
  }, [metroOn, song.bpm, song.timeSignature, song.offsetMs, song.audioBuffer]);

  const measures = useMemo(
    () => (chart ? splitByMeasure(chart, song.offsetMs) : []),
    [chart, song.offsetMs],
  );
  const measureMs = chart ? measureDurationMs(chart) : 0;

  const seekMeasure = (i: number) => {
    setSelMeasure(i);
    songPlayer.seek(song.offsetMs + i * measureMs);
    if (!songPlayer.playing) setPosMs(song.offsetMs + i * measureMs);
  };

  const fmtTime = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const markManual = () => {
    if (song.metaSource) song.setSong({ metaSource: "manual" });
  };

  // ---- 未导入：拖放区 ----
  if (!song.audioBuffer) {
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
          const f = e.dataTransfer.files?.[0];
          if (f) void importFile(f);
        }}
        className={`flex h-64 flex-col items-center justify-center gap-3 border border-dashed transition-colors ${
          dragOver ? "border-[var(--taiko-ink)] bg-[var(--taiko-ink)]/5" : "border-[var(--taiko-line)]"
        }`}
      >
        <p className="text-sm text-[var(--taiko-ink)]/70">把 mp3 / wav 拖到这里</p>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="border border-[var(--taiko-ink)] px-6 py-2 text-sm text-[var(--taiko-ink)] transition-colors hover:bg-[var(--taiko-ink)] hover:text-[var(--taiko-paper)]"
        >
          选择文件
        </button>
        {busy && <p className="text-xs text-[var(--taiko-ink)]/50">{busy}</p>}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  const durationMs = song.audioBuffer.duration * 1000;

  return (
    <div className="flex flex-col gap-6">
      {/* 歌曲信息 + 导入 */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-[var(--taiko-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{song.fileName}</div>
          <div className="text-xs tabular-nums text-[var(--taiko-ink)]/50">
            {fmtTime(durationMs)} · {song.audioBuffer.sampleRate} Hz
          </div>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="ml-auto border border-[var(--taiko-line)] px-3 py-1.5 text-xs text-[var(--taiko-ink)]/70 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
        >
          重新导入
        </button>
        {busy && <span className="text-xs text-[var(--taiko-ink)]/50">{busy}</span>}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* 速度 / 拍号 / 节拍器 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border border-[var(--taiko-line)] px-4 py-3">
        <label className="flex items-center gap-2 text-xs text-[var(--taiko-ink)]/60">
          BPM
          <input
            type="number"
            min={40}
            max={300}
            step={0.1}
            value={song.bpm}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 40 && v <= 300) {
                markManual();
                song.setSong({ bpm: v });
              }
            }}
            className="w-20 border border-[var(--taiko-line)] bg-transparent px-2 py-1 text-sm tabular-nums text-[var(--taiko-ink)]"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--taiko-ink)]/60">
          拍号
          <select
            value={`${song.timeSignature[0]}/${song.timeSignature[1]}`}
            onChange={(e) => {
              const values = e.target.value.split("/").map(Number);
              const a = values[0];
              const b = values[1];
              if (a === undefined || b === undefined) return;
              markManual();
              song.setSong({ timeSignature: [a, b] });
            }}
            className="border border-[var(--taiko-line)] bg-transparent px-2 py-1 text-sm tabular-nums text-[var(--taiko-ink)]"
          >
            {TIME_SIGS.map(([a, b]) => (
              <option key={`${a}/${b}`} value={`${a}/${b}`}>
                {a}/{b}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--taiko-ink)]/60">
          首拍偏移 ms
          <input
            type="number"
            step={10}
            value={Math.round(song.offsetMs)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) {
                markManual();
                song.setSong({ offsetMs: v });
              }
            }}
            className="w-24 border border-[var(--taiko-line)] bg-transparent px-2 py-1 text-sm tabular-nums text-[var(--taiko-ink)]"
          />
        </label>
        <span className="text-xs text-[var(--taiko-ink)]/45">
          {metaSource === "metadata"
            ? "来自文件元数据"
            : metaSource === "manual"
              ? "手动调整"
              : "自动检测"}
        </span>
        <button
          onClick={() => void reanalyze()}
          disabled={busy !== null}
          className="border border-[var(--taiko-line)] px-3 py-1.5 text-xs text-[var(--taiko-ink)]/70 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)] disabled:opacity-40"
        >
          按当前参数重新分析
        </button>

        <span className="mx-1 h-5 w-px bg-[var(--taiko-line)]" />
        <button
          onClick={togglePlay}
          className="border border-[var(--taiko-ink)] px-4 py-1.5 text-xs text-[var(--taiko-ink)] transition-colors hover:bg-[var(--taiko-ink)] hover:text-[var(--taiko-paper)]"
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

      {/* 节奏段落卡片 */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-medium">鼓节奏段落</h2>
          <span className="text-xs text-[var(--taiko-ink)]/45">
            选择一个主体节奏 · 自动匹配基础节奏型后生成整段谱面
          </span>
        </div>
        {segments.length === 0 ? (
          <p className="border border-[var(--taiko-line)] px-4 py-6 text-center text-xs text-[var(--taiko-ink)]/45">
            {busy ? busy : "未识别到明显的鼓节奏型，可尝试调整 BPM 后重新分析"}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {segments.map((seg) => (
              <SegmentCard
                key={seg.id}
                seg={seg}
                checked={song.primarySegmentId === seg.id}
                onToggle={() =>
                  song.setSong({
                    primarySegmentId: seg.id,
                    grooveId: matchGroove(seg, song.bpm).id,
                  })
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* 基础节奏型 + 密度档位 */}
      {segments.length > 0 && (
        <section className="flex flex-col gap-3 border border-[var(--taiko-line)] px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-sm font-medium">基础节奏型</h2>
            <span className="text-xs text-[var(--taiko-ink)]/45">
              自动匹配「{grooveRanking[0]?.pattern.label ?? "-"}」，可手动改选；
              游玩谱面以基础型为主，偶尔加变体
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {grooveRanking.map(({ pattern }, i) => (
              <button
                key={pattern.id}
                onClick={() => song.setSong({ grooveId: pattern.id })}
                className={`border px-3 py-1.5 text-xs transition-colors ${
                  groove.id === pattern.id
                    ? "border-[var(--taiko-ink)] bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                    : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/70 hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
                }`}
              >
                {pattern.label}
                {i === 0 ? " ·推荐" : ""}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--taiko-ink)]/50">谱面密度</span>
            {(["easy", "normal", "raw"] as Density[]).map((d) => (
              <button
                key={d}
                onClick={() => song.setSong({ density: d })}
                className={`-ml-px border border-[var(--taiko-line)] px-3 py-1.5 text-xs transition-colors first:ml-0 ${
                  song.density === d
                    ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                    : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
                }`}
              >
                {DENSITY_LABEL[d]}
              </button>
            ))}
            <span className="text-xs text-[var(--taiko-ink)]/40">
              轻松＝每小节最多 6 音、镲只到四分；标准＝最多 10 音、镲到八分
            </span>
          </div>
        </section>
      )}


      {/* 小节网格（只读，点击跳转播放） */}
      {chart && (
        <div className="grid gap-6 lg:grid-cols-[1fr_220px]">
          <div className="flex flex-col divide-y divide-[var(--taiko-line)] border border-[var(--taiko-line)]">
            {measures.length === 0 || chart.notes.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-[var(--taiko-ink)]/45">
                谱面为空：请选择上方一个主体节奏
              </p>
            ) : (
              measures.map((m, i) => {
                const cells = Array.from({ length: 8 }, (_, s) => {
                  const start = song.offsetMs + i * measureMs + (s * measureMs) / 8;
                  const end = start + measureMs / 8;
                  return m.find((n) => n.timeMs >= start && n.timeMs < end) ?? null;
                });
                return (
                  <div
                    key={i}
                    onClick={() => seekMeasure(i)}
                    title="点击从该小节播放"
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${
                      selMeasure === i ? "bg-[var(--taiko-ink)]/5" : "hover:bg-[var(--taiko-ink)]/5"
                    }`}
                  >
                    <span className="w-8 shrink-0 text-xs tabular-nums text-[var(--taiko-ink)]/45">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="grid flex-1 grid-cols-8 gap-[3px]">
                      {cells.map((n, s) => {
                        const part = n?.note !== undefined ? PART_BY_ID_COLOR(n.note) : null;
                        return (
                          <span
                            key={s}
                            className="flex h-7 items-center justify-center border border-[var(--taiko-line)]"
                          >
                            {n ? (
                              <i
                                className="block rounded-full"
                                style={{
                                  width: 12,
                                  height: 12,
                                  backgroundColor: part ?? "var(--taiko-ka)",
                                }}
                              />
                            ) : null}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <aside className="h-fit border border-[var(--taiko-line)] p-4 text-sm text-[var(--taiko-ink)]">
            <dl className="flex flex-col gap-3">
              <Stat label="BPM" value={String(chart.bpm)} />
              <Stat label="拍号" value={`${chart.timeSignature[0]}/${chart.timeSignature[1]}`} />
              <Stat label="小节数" value={String(measures.length)} />
              <Stat label="音符总数" value={String(chart.notes.length)} />
              <Stat
                label="主体节奏"
                value={song.primarySegmentId ? `${segments.findIndex((s) => s.id === song.primarySegmentId) + 1} / ${segments.length}` : "未选择"}
              />
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-[var(--taiko-ink)]/45">
              音符颜色对应鼓件颜色（底鼓红 / 军鼓蓝 / 踩镲橙）。点击小节可跳转试听。
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}

/** 段落卡片：缩略网格 + 出现信息 + 主体单选 */
function SegmentCard({
  seg,
  checked,
  onToggle,
}: {
  seg: DrumSegment;
  checked: boolean;
  onToggle: () => void;
}) {
  const bands: DrumBand[] = ["kick", "snare", "hihat"];
  const minBar = Math.min(...seg.bars) + 1;
  const maxBar = Math.max(...seg.bars) + 1;
  return (
    <button
      onClick={onToggle}
      aria-pressed={checked}
      className={`flex flex-col gap-2 border p-3 text-left transition-colors ${
        checked
          ? "border-[var(--taiko-ink)] bg-[var(--taiko-ink)]/5"
          : "border-[var(--taiko-line)] hover:border-[var(--taiko-ink)]/50"
      }`}
    >
      <div className="flex items-center gap-2 text-xs">
        <i
          className={`inline-block h-3 w-3 rounded-full border ${
            checked ? "border-[var(--taiko-ink)] bg-[var(--taiko-ink)]" : "border-[var(--taiko-line)]"
          }`}
        />
        <span className="tabular-nums text-[var(--taiko-ink)]/70">
          出现 {seg.bars.length} 次 · 第 {minBar}
          {maxBar !== minBar ? `–${maxBar}` : ""} 小节等
        </span>
        <span className="ml-auto tabular-nums text-[var(--taiko-ink)]/45">
          {seg.notes.length} 音/小节
        </span>
      </div>
      <div className="relative h-14 w-full border border-[var(--taiko-line)] bg-[var(--taiko-paper)]">
        {bands.map((band, ri) => (
          <div
            key={band}
            className="absolute left-0 right-0 border-t border-[var(--taiko-line)]/60 first:border-t-0"
            style={{ top: `${(ri * 100) / 3}%`, height: `${100 / 3}%` }}
          >
            <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[9px] text-[var(--taiko-ink)]/40">
              {BAND_LABEL[band]}
            </span>
          </div>
        ))}
        {seg.notes.map((n, i) => (
          <i
            key={i}
            className="absolute block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${((n.beat + 0.125) / seg.beatsPerBar) * 100}%`,
              top: `${(bands.indexOf(n.band) * 100) / 3 + 100 / 6}%`,
              backgroundColor: PART_BY_ID[BAND_NOTE[n.band] === 36 ? "kick" : BAND_NOTE[n.band] === 38 ? "snare" : "hihat"].color,
            }}
          />
        ))}
      </div>
    </button>
  );
}

/** 音符 → 鼓件色（经 PART_BY_ID，色号与游玩屏一致） */
function PART_BY_ID_COLOR(note: number): string | null {
  for (const p of Object.values(PART_BY_ID)) {
    if (p.notes.includes(note)) return p.color;
  }
  return null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--taiko-line)] pb-2 last:border-0">
      <dt className="text-xs uppercase tracking-[0.15em] text-[var(--taiko-ink)]/50">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
