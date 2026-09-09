import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KEY_BY_PART,
  PART_BY_ID,
  VISIBLE_PARTS,
  partOfNote,
  type PartId,
} from "./laneLayouts";
import { renderStage } from "./stageRenderer";
import { renderRunway } from "./runwayRenderer";
import { useSong } from "./songStore";
import { songPlayer } from "./player";
import { hasAnyStem, stemsDurationMs } from "./stems";
import { midiManager } from "./midiInput";
import { click as metronomeClick } from "./metronome";
import { DIFFICULTIES, layoutOf } from "./difficulty";
import { getPlayChart } from "./chartCache";
import { HP_GOOD, HP_MAX, HP_MISS, HP_PERFECT, clampHp, survivalSpeed } from "./survival";


const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
const FLASH_MS = 200;
/** 判定窗口：Perfect ±50ms / Good ±120ms，超时未击为 Miss（调手感改这里） */
const PERFECT_MS = 50;
const GOOD_MS = 120;
/** 倒计时拍数（四分音符，无视拍号） */
const COUNT_IN_BEATS = 4;


type Phase = "idle" | "countdown" | "playing" | "paused" | "ended";

/** 游玩模式：舞台下落 / 节奏跑道 / 生存 */
export type PlayMode = "stage" | "runway" | "survival";

export function FallScreen({
  speed,
  playMode,
  onSpeedChange,
  onPlayModeChange,
}: {
  speed: number;
  playMode: PlayMode;
  onSpeedChange: (s: number) => void;
  onPlayModeChange: (m: PlayMode) => void;
}) {
  const song = useSong();
  const { stems } = song;
  const hasAudio = hasAnyStem(stems);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [mixerOpen, setMixerOpen] = useState(false);
  const phaseRef = useRef<Phase>("idle");
  const timeRef = useRef(0);
  const flashesRef = useRef<Record<string, number>>({});
  const missFlashesRef = useRef<Record<string, number>>({});
  const judgementRef = useRef<{ text: string; color: string; until: number } | null>(null);
  /** 0 未判定 / 1 命中 / 2 Miss */
  const judgedRef = useRef<Uint8Array>(new Uint8Array(0));
  /** 长音符（左踏板踩住闭镲）状态：0 未开始 / 1 按住中 / 2 已断开或结算 */
  const holdStateRef = useRef<Uint8Array>(new Uint8Array(0));
  /** 左踏板当前是否被踩住（键盘 keyup / MIDI note-off 抬起） */
  const pedalHeldRef = useRef(false);
  const statsRef = useRef({ perfect: 0, good: 0, miss: 0 });
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const scoreRef = useRef(0);
  const missCursorRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const countdownStartRef = useRef(0);
  const countdownMsRef = useRef(0);
  const beatMsRef = useRef(500);
  /** 无音频（仅 MIDI）静音试玩时的起始时刻 */
  const silentStartRef = useRef(0);
  /** 生存模式血量 */
  const hpRef = useRef(HP_MAX);
  const [deadOut, setDeadOut] = useState(false);

  const layout = layoutOf(song.difficulty);
  const parts = VISIBLE_PARTS[layout];
  const durationMs = stemsDurationMs(stems) || (song.midi?.durationMs ?? 0);
  const survival = playMode === "survival";

  /**
   * 谱面 = 鼓 MIDI 拆解后按当前难度重编，并按「文件名 + MIDI 指纹」固化，
   * 刷新或重开都拿到同一份。
   */
  const playChart = useMemo(() => {
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
  }, [
    song.midi,
    song.fileName,
    song.offsetMs,
    song.phaseBeatOffset,
    song.difficulty,
  ]);





  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const resetRun = useCallback(() => {
    judgedRef.current = new Uint8Array(playChart?.notes.length ?? 0);
    holdStateRef.current = new Uint8Array(playChart?.notes.length ?? 0);
    statsRef.current = { perfect: 0, good: 0, miss: 0 };
    comboRef.current = 0;
    maxComboRef.current = 0;
    scoreRef.current = 0;
    missCursorRef.current = 0;
    flashesRef.current = {};
    missFlashesRef.current = {};
    judgementRef.current = null;
    hpRef.current = HP_MAX;
    setDeadOut(false);
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
    songPlayer.load(stems);
    setPhaseBoth("idle");
    return () => songPlayer.stop();
  }, [stems, setPhaseBoth]);

  // 调音台音量 → 播放器（实时生效）
  useEffect(() => {
    songPlayer.setStemGain("vocals", song.mix.vocals);
    songPlayer.setStemGain("drums", song.mix.drums);
  }, [song.mix, stems]);

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
      // 长音符：踩下即进入「按住中」，之后由渲染循环检查是否全程踩住
      if ((notes[best]!.holdMs ?? 0) > 0) holdStateRef.current[best] = 1;
      const perfect = bestDiff <= PERFECT_MS;
      statsRef.current[perfect ? "perfect" : "good"]++;
      comboRef.current++;
      maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
      scoreRef.current += perfect ? 300 : 100;
      if (survival) {
        hpRef.current = clampHp(hpRef.current + (perfect ? HP_PERFECT : HP_GOOD));
      }
      judgementRef.current = {
        text: perfect ? "PERFECT" : "GOOD",
        color: perfect ? "#ffd75e" : "#7dd3fc",
        until: now + 500,
      };
    },
    [playChart, survival],
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
    if (!playChart || playChart.notes.length === 0) return;
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
        if (hasAudio) songPlayer.play(0);
        else silentStartRef.current = performance.now();
        setPhaseBoth("playing");
      }, COUNT_IN_BEATS * beatMs),
    );
  }, [hasAudio, playChart, resetRun, setPhaseBoth]);


  const togglePause = useCallback(() => {
    if (phaseRef.current === "playing") {
      if (hasAudio) songPlayer.pause();
      setPhaseBoth("paused");
    } else if (phaseRef.current === "paused") {
      if (hasAudio) songPlayer.play();
      else silentStartRef.current = performance.now() - timeRef.current;
      setPhaseBoth("playing");
    }
  }, [stems, setPhaseBoth]);


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
      if (ph === "playing") {
        t = hasAudio ? songPlayer.timeMs() : now - silentStartRef.current;
        if (!hasAudio && playChart && t > playChart.durationMs) {
          phaseRef.current = "ended";
          setPhase("ended");
        }
      } else if (ph === "countdown") {
        t = now - countdownStartRef.current - countdownMsRef.current;
      } else if (ph === "idle") t = 0;
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
            if (survival) {
              hpRef.current = clampHp(hpRef.current + HP_MISS);
              if (hpRef.current <= 0) {
                phaseRef.current = "ended";
                setPhase("ended");
                setDeadOut(true);
                songPlayer.stop();
              }
            }
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

      const frame = {
        chart: frameChart,
        timeMs: t,
        // 生存模式：连击越高下落越快
        speed: survival ? survivalSpeed(speed, comboRef.current) : speed,
        now,
        flashes: flashesRef.current,
        missFlashes: missFlashesRef.current,
        combo: comboRef.current,
        score: scoreRef.current,
        parts,
        judgement: judgementRef.current,
        countText,
        stats: statsRef.current,
        hp: survival ? hpRef.current / HP_MAX : null,
      };

      if (playMode === "runway") {
        renderRunway(ctx, canvas.clientWidth, canvas.clientHeight, frame);
      } else {
        renderStage(ctx, canvas.clientWidth, canvas.clientHeight, frame);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [playChart, speed, parts, playMode, hasAudio, survival]);

  const judged = statsRef.current;
  const totalJudged = judged.perfect + judged.good + judged.miss;
  const acc = totalJudged > 0 ? ((judged.perfect + judged.good * 0.5) / totalJudged) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={wrapRef}
        className="relative mx-auto w-full overflow-hidden border border-[var(--taiko-line)]"
        style={{
          // 演奏区始终 16:9
          aspectRatio: "16 / 9",
          maxHeight: "min(70vh, 720px)",
          maxWidth: "calc(min(70vh, 720px) * 16 / 9)",
          backgroundColor: "#0a0a0c",
        }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />

        {/* 调音台：Vocals / Drums 音量，100% = 原始文件音量 */}
        <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
          <button
            onClick={() => setMixerOpen((v) => !v)}
            className="border border-white/35 bg-black/40 px-3 py-1 text-[11px] tracking-wide text-white/80 backdrop-blur transition-colors hover:border-white/80 hover:text-white"
          >
            调音台
          </button>
          {mixerOpen && (
            <div className="flex w-56 flex-col gap-3 border border-white/25 bg-black/55 px-3 py-3 backdrop-blur">
              {(
                [
                  ["vocals", "Vocals"],
                  ["drums", "Drums"],
                ] as const
              ).map(([key, label]) => {
                const track = stems[key];
                const value = song.mix[key];
                return (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="flex items-center justify-between text-[11px] text-white/70">
                      <span className={track ? "" : "text-white/35"}>
                        {label}
                        {track ? "" : "（无此轨）"}
                      </span>
                      <span className="tabular-nums text-white/55">
                        {Math.round(value * 100)}%
                      </span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(value * 100)}
                      disabled={!track}
                      onChange={(e) =>
                        song.setSong({
                          mix: { ...song.mix, [key]: Number(e.target.value) / 100 },
                        })
                      }
                      className="h-1 w-full cursor-pointer appearance-none rounded bg-white/25 accent-white disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </label>
                );
              })}
              <p className="text-[10px] leading-snug text-white/40">
                100% = 原始文件音量；Drums 开出来可当参考
              </p>
            </div>
          )}
        </div>

        {/* 空态 / 开始 / 暂停 / 结算遮罩 */}
        {!song.midi && (
          <Overlay>
            <p className="text-sm text-white/80">还没有谱面</p>
            <p className="text-xs text-white/50">
              请先到「谱面」屏导入去鼓伴奏音频与对应的鼓 MIDI
            </p>
          </Overlay>
        )}
        {song.midi && (!playChart || playChart.notes.length === 0) && (
          <Overlay>
            <p className="text-sm text-white/80">谱面为空</p>
            <p className="text-xs text-white/50">该 MIDI 中没有可识别的鼓音符</p>
          </Overlay>
        )}
        {song.midi && playChart && playChart.notes.length > 0 && phase === "idle" && (
          <Overlay>
            <button
              onClick={start}
              className="border border-white/70 px-10 py-3 text-base tracking-[0.3em] text-white transition-colors hover:bg-white hover:text-black"
            >
              开始
            </button>
            <p className="text-xs text-white/40">
              回车也可开始 · 空格暂停{hasAudio ? "" : " · 无音频，静音试玩"}
            </p>
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
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">
              {deadOut ? "Failed · 体力耗尽" : "Result"}
            </p>
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
        <span className="text-xs text-[var(--taiko-ink)]/50">模式</span>
        {(
          [
            ["stage", "舞台下落"],
            ["runway", "节奏跑道"],
            ["survival", "生存"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => onPlayModeChange(mode)}
            className={`-ml-px border border-[var(--taiko-line)] px-3 py-1.5 text-xs transition-colors first:ml-0 ${
              playMode === mode
                ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
            }`}
          >
            {label}
          </button>
        ))}

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
        <span className="text-xs text-[var(--taiko-ink)]/50">难度</span>
        {DIFFICULTIES.map((d) => (
          <button
            key={d.id}
            onClick={() => song.setSong({ difficulty: d.id })}
            title={d.hint}
            className={`-ml-px border border-[var(--taiko-line)] px-3 py-1.5 text-xs transition-colors first:ml-0 ${
              song.difficulty === d.id
                ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
            }`}
          >
            {d.label}
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
