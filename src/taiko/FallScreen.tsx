import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KEY_BY_PART,
  PART_BY_ID,
  VISIBLE_PARTS,
  partOfNote,
  type LayoutMode,
  type PartId,
} from "./laneLayouts";
import { renderStage } from "./stageRenderer";
import { renderOsu } from "./osuRenderer";
import { useSong } from "./songStore";
import { songPlayer } from "./player";
import { midiManager } from "./midiInput";
import { click as metronomeClick } from "./metronome";
import { arrangeChart } from "./arrange";
import {
  GROOVE_BY_ID,
  customIsEmpty,
  patternFromCustom,
  resizeCustom,
} from "./groovePatterns";
import { matchGroove } from "./grooveMatch";

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
const FLASH_MS = 200;
/** 判定窗口：Perfect ±50ms / Good ±120ms，超时未击为 Miss（调手感改这里） */
const PERFECT_MS = 50;
const GOOD_MS = 120;
/** 倒计时拍数（四分音符，无视拍号） */
const COUNT_IN_BEATS = 4;

type Phase = "idle" | "countdown" | "playing" | "paused" | "ended";

export function FallScreen({
  layout,
  speed,
  onLayoutChange,
  onSpeedChange,
}: {
  layout: LayoutMode;
  speed: number;
  onLayoutChange: (m: LayoutMode) => void;
  onSpeedChange: (s: number) => void;
}) {
  const song = useSong();
  const { audioBuffer } = song;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const timeRef = useRef(0);
  const flashesRef = useRef<Record<string, number>>({});
  const missFlashesRef = useRef<Record<string, number>>({});
  const judgementRef = useRef<{ text: string; color: string; until: number } | null>(null);
  /** 0 未判定 / 1 命中 / 2 Miss */
  const judgedRef = useRef<Uint8Array>(new Uint8Array(0));
  const statsRef = useRef({ perfect: 0, good: 0, miss: 0 });
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const scoreRef = useRef(0);
  const missCursorRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const countdownStartRef = useRef(0);
  const countdownMsRef = useRef(0);
  const beatMsRef = useRef(500);

  const parts = VISIBLE_PARTS[layout];

  /** 以基础节奏型（或自定义节奏）为骨架，按当前分区/难度/风格重新编谱。 */
  const playChart = useMemo(() => {
    if (!audioBuffer) return null;
    const beatsPerBar = song.timeSignature[0] * (4 / song.timeSignature[1]);
    const primary = song.segments.find((s) => s.id === song.primarySegmentId) ?? null;
    let groove;
    if (song.useCustom && !customIsEmpty(song.customPattern)) {
      groove = patternFromCustom(
        resizeCustom(song.customPattern, beatsPerBar),
        beatsPerBar,
        song.bpm,
      );
    } else {
      if (!song.primarySegmentId || song.segments.length === 0) return null;
      groove =
        (song.grooveId ? GROOVE_BY_ID[song.grooveId] : undefined) ?? matchGroove(primary, song.bpm);
    }
    return arrangeChart({
      groove,
      barActivity: song.barActivity,
      barBands: song.barBands,
      activeRange: song.activeRange,
      layout,
      density: song.density,
      style: song.style,
      bpm: song.bpm,
      offsetMs: song.offsetMs,
      timeSignature: song.timeSignature,
      durationMs: audioBuffer.duration * 1000,
      title: song.fileName,
    });
  }, [
    audioBuffer,
    layout,
    song.activeRange,
    song.barActivity,
    song.barBands,
    song.bpm,
    song.customPattern,
    song.density,
    song.fileName,
    song.grooveId,
    song.offsetMs,
    song.primarySegmentId,
    song.segments,
    song.style,
    song.timeSignature,
    song.useCustom,
  ]);


  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const resetRun = useCallback(() => {
    judgedRef.current = new Uint8Array(playChart?.notes.length ?? 0);
    statsRef.current = { perfect: 0, good: 0, miss: 0 };
    comboRef.current = 0;
    maxComboRef.current = 0;
    scoreRef.current = 0;
    missCursorRef.current = 0;
    flashesRef.current = {};
    missFlashesRef.current = {};
    judgementRef.current = null;
  }, [playChart]);

  useEffect(() => {
    songPlayer.stop();
    resetRun();
    setPhaseBoth("idle");
  }, [playChart, resetRun, setPhaseBoth]);

  useEffect(() => {
    if (playChart && song.chart !== playChart) song.setSong({ chart: playChart });
    // playChart 只在编谱输入变化时重建；chart 本身不参与其依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playChart]);

  // 音频装载 / 卸载
  useEffect(() => {
    songPlayer.load(audioBuffer);
    setPhaseBoth("idle");
    return () => songPlayer.stop();
  }, [audioBuffer, setPhaseBoth]);

  useEffect(() => {
    songPlayer.setOnEnded(() => setPhaseBoth("ended"));
    return () => songPlayer.setOnEnded(null);
  }, [setPhaseBoth]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  // 击打：闪光 + 命中判定（空击只闪光不惩罚）
  const hitPart = useCallback(
    (part: PartId) => {
      const now = performance.now();
      flashesRef.current[part] = now + FLASH_MS;
      if (phaseRef.current !== "playing" || !playChart) return;
      const t = timeRef.current;
      const notes = playChart.notes;
      let best = -1;
      let bestDiff = Infinity;
      for (let i = 0; i < notes.length; i++) {
        if (judgedRef.current[i]) continue;
        const n = notes[i]!;
        if (n.note === undefined || partOfNote(n.note) !== part) continue;
        const diff = Math.abs(n.timeMs - t);
        if (diff <= GOOD_MS && diff < bestDiff) {
          best = i;
          bestDiff = diff;
        }
      }
      if (best < 0) return;
      judgedRef.current[best] = 1;
      const perfect = bestDiff <= PERFECT_MS;
      statsRef.current[perfect ? "perfect" : "good"]++;
      comboRef.current++;
      maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
      scoreRef.current += perfect ? 300 : 100;
      judgementRef.current = {
        text: perfect ? "PERFECT" : "GOOD",
        color: perfect ? "#ffd75e" : "#7dd3fc",
        until: now + 500,
      };
    },
    [playChart],
  );

  // MIDI 击打
  useEffect(() => {
    void midiManager.init();
    return midiManager.onNote((note) => {
      const part = partOfNote(note);
      if (part && parts.includes(part)) hitPart(part);
    });
  }, [hitPart, parts]);

  // 键盘调试（无 MIDI 设备时）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      for (const [part, v] of Object.entries(KEY_BY_PART) as [PartId, { key: string }][]) {
        if (v.key === k && parts.includes(part)) {
          hitPart(part);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hitPart, parts]);

  // 手动开始 → 4 拍倒计时（四分音符）→ 播放
  const start = useCallback(() => {
    if (!audioBuffer || !playChart || playChart.notes.length === 0) return;
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    resetRun();
    const beatMs = 60000 / playChart.bpm;
    beatMsRef.current = beatMs;
    countdownMsRef.current = COUNT_IN_BEATS * beatMs;
    countdownStartRef.current = performance.now();
    timeRef.current = -countdownMsRef.current;
    setPhaseBoth("countdown");
    for (let i = 0; i < COUNT_IN_BEATS; i++) {
      timersRef.current.push(
        window.setTimeout(() => metronomeClick(i === 0), i * beatMs),
      );
    }
    timersRef.current.push(
      window.setTimeout(() => {
        songPlayer.play(0);
        setPhaseBoth("playing");
      }, COUNT_IN_BEATS * beatMs),
    );
  }, [audioBuffer, playChart, resetRun, setPhaseBoth]);

  const togglePause = useCallback(() => {
    if (phaseRef.current === "playing") {
      songPlayer.pause();
      setPhaseBoth("paused");
    } else if (phaseRef.current === "paused") {
      songPlayer.play();
      setPhaseBoth("playing");
    }
  }, [setPhaseBoth]);

  // 空格暂停/继续，回车开始
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " && (phaseRef.current === "playing" || phaseRef.current === "paused")) {
        e.preventDefault();
        togglePause();
      } else if (
        e.key === "Enter" &&
        (phaseRef.current === "idle" || phaseRef.current === "ended")
      ) {
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePause, start]);

  // 渲染循环
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = wrap.clientWidth * dpr;
      canvas.height = wrap.clientHeight * dpr;
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = (now: number) => {
      const ph = phaseRef.current;
      let t = timeRef.current;
      if (ph === "playing") t = songPlayer.timeMs();
      else if (ph === "countdown") t = now - countdownStartRef.current - countdownMsRef.current;
      else if (ph === "idle") t = 0;
      // paused / ended：冻结
      timeRef.current = t;

      // Miss 检测：超过 Good 窗未击
      if (ph === "playing" && playChart) {
        const notes = playChart.notes;
        let c = missCursorRef.current;
        while (c < notes.length && notes[c]!.timeMs < t - GOOD_MS) {
          if (!judgedRef.current[c]) {
            judgedRef.current[c] = 2;
            statsRef.current.miss++;
            comboRef.current = 0;
            const note = notes[c]!.note;
            const p = note !== undefined ? partOfNote(note) : null;
            if (p) missFlashesRef.current[p] = now + 240;
            judgementRef.current = { text: "MISS", color: "#f87171", until: now + 500 };
          }
          c++;
        }
        missCursorRef.current = c;
      }

      const frameChart =
        playChart ?? {
          title: "",
          bpm: 120,
          timeSignature: [4, 4] as [number, number],
          durationMs: 1,
          notes: [],
        };
      const countText =
        ph === "countdown"
          ? String(
              Math.max(
                1,
                Math.ceil((countdownMsRef.current - (now - countdownStartRef.current)) / beatMsRef.current),
              ),
            )
          : null;

      renderStage(ctx, canvas.clientWidth, canvas.clientHeight, {
        chart: frameChart,
        timeMs: t,
        speed,
        now,
        flashes: flashesRef.current,
        missFlashes: missFlashesRef.current,
        combo: comboRef.current,
        score: scoreRef.current,
        parts,
        judgement: judgementRef.current,
        countText,
        stats: statsRef.current,
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [playChart, speed, parts]);

  const judged = statsRef.current;
  const totalJudged = judged.perfect + judged.good + judged.miss;
  const acc = totalJudged > 0 ? ((judged.perfect + judged.good * 0.5) / totalJudged) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden border border-[var(--taiko-line)]"
        style={{
          height: "min(64vh, 660px)",
          minHeight: 420,
          backgroundColor: "#0a0a0c",
        }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />

        {/* 空态 / 开始 / 暂停 / 结算遮罩 */}
        {!audioBuffer && (
          <Overlay>
            <p className="text-sm text-white/80">还没有歌曲</p>
            <p className="text-xs text-white/50">请先到「谱面」屏导入 mp3 / wav 并生成谱面</p>
          </Overlay>
        )}
        {audioBuffer && (!playChart || playChart.notes.length === 0) && (
          <Overlay>
            <p className="text-sm text-white/80">谱面为空</p>
            <p className="text-xs text-white/50">请到「谱面」屏选择一个主体节奏</p>
          </Overlay>
        )}
        {audioBuffer && playChart && playChart.notes.length > 0 && phase === "idle" && (
          <Overlay>
            <button
              onClick={start}
              className="border border-white/70 px-10 py-3 text-base tracking-[0.3em] text-white transition-colors hover:bg-white hover:text-black"
            >
              开始
            </button>
            <p className="text-xs text-white/40">回车也可开始 · 空格暂停</p>
          </Overlay>
        )}
        {phase === "paused" && (
          <Overlay>
            <p className="text-lg tracking-[0.3em] text-white">已暂停</p>
            <div className="flex gap-3">
              <button
                onClick={togglePause}
                className="border border-white/70 px-6 py-2 text-sm text-white transition-colors hover:bg-white hover:text-black"
              >
                继续
              </button>
              <button
                onClick={start}
                className="border border-white/30 px-6 py-2 text-sm text-white/70 transition-colors hover:border-white/70 hover:text-white"
              >
                重新开始
              </button>
            </div>
          </Overlay>
        )}
        {phase === "ended" && (
          <Overlay>
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Result</p>
            <p className="text-3xl font-bold tabular-nums text-white">
              {String(scoreRef.current).padStart(7, "0")}
            </p>
            <p className="text-sm tabular-nums text-white/75">
              最大连击 {maxComboRef.current} · 准确率 {acc.toFixed(1)}%
            </p>
            <p className="text-xs tabular-nums text-white/50">
              Perfect {judged.perfect} · Good {judged.good} · Miss {judged.miss}
            </p>
            <button
              onClick={start}
              className="mt-2 border border-white/70 px-8 py-2 text-sm tracking-[0.2em] text-white transition-colors hover:bg-white hover:text-black"
            >
              再来一次
            </button>
          </Overlay>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={togglePause}
          disabled={phase !== "playing" && phase !== "paused"}
          className="border border-[var(--taiko-ink)] px-5 py-2 text-sm tracking-wide text-[var(--taiko-ink)] transition-colors hover:bg-[var(--taiko-ink)] hover:text-[var(--taiko-paper)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          {phase === "paused" ? "继续" : "暂停"}
        </button>

        <span className="mx-2 h-5 w-px bg-[var(--taiko-line)]" />
        <span className="text-xs text-[var(--taiko-ink)]/50">速度</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            className={`-ml-px border border-[var(--taiko-line)] px-3 py-1.5 text-xs tabular-nums transition-colors first:ml-0 ${
              speed === s
                ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
            }`}
          >
            {s}x
          </button>
        ))}

        <span className="mx-2 h-5 w-px bg-[var(--taiko-line)]" />
        <span className="text-xs text-[var(--taiko-ink)]/50">分区</span>
        {(
          [
            ["five", "5分区"],
            ["nine", "9分区"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => onLayoutChange(mode)}
            className={`-ml-px border border-[var(--taiko-line)] px-3 py-1.5 text-xs transition-colors first:ml-0 ${
              layout === mode
                ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
            }`}
          >
            {label}
          </button>
        ))}

        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--taiko-ink)]/55">
          {parts.map((p) => (
            <span key={p} className="flex items-center gap-1.5">
              <kbd className="border border-[var(--taiko-line)] px-1.5 py-0.5 font-mono text-[10px]">
                {KEY_BY_PART[p].label}
              </kbd>
              <i
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: PART_BY_ID[p].color }}
              />
              {PART_BY_ID[p].label}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/55">
      {children}
    </div>
  );
}
