import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KEY_BY_PART, PART_BY_ID, VISIBLE_PARTS, partOfNote, type PartId } from "./laneLayouts";
import { renderStage } from "./stageRenderer";
import { useSong } from "./songStore";
import { songPlayer } from "./player";
import { STEM_KINDS, STEM_LABEL, hasAnyStem, stemsDurationMs } from "./stems";
import { midiManager } from "./midiInput";
import { stickManager } from "./stickInput";
import { DebugLogPanel } from "./DebugLogPanel";
import { click as metronomeClick, getAudioContext } from "./metronome";
import { loadKitEnabled, playDrum, saveKitEnabled } from "./drumKit";

import { DIFFICULTIES, layoutOf } from "./difficulty";
import { getPlayChart } from "./chartCache";

import { TIER_LABEL, quality, type QualityMode, type QualityTier } from "./perf";
import {
  CALIB_RANGE,
  DEFAULT_CALIBRATION,
  loadCalibration,
  saveCalibration,
  tapOffsetMs,
  type Calibration,
} from "./calibration";

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
const FLASH_MS = 200;
/** 判定窗口：Perfect ±50ms / Good ±120ms，超时未击为 Miss（调手感改这里） */
const PERFECT_MS = 50;
const GOOD_MS = 120;
/** 倒计时拍数（四分音符，无视拍号） */
const COUNT_IN_BEATS = 4;

type Phase = "idle" | "countdown" | "playing" | "paused" | "ended";

export function FallScreen({
  speed,
  onSpeedChange,
}: {
  speed: number;
  onSpeedChange: (s: number) => void;
}) {
  const song = useSong();
  const { stems } = song;
  const hasAudio = hasAnyStem(stems);
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

  // 画质档位（auto 会自动降档；tier 变化时重设画布分辨率）
  const [qualityMode, setQualityMode] = useState<QualityMode>("auto");
  const [tier, setTier] = useState<QualityTier>("high");
  useEffect(() => {
    quality.hydrate();
    setQualityMode(quality.getMode());
    setTier(quality.tier);
    const off = quality.subscribe(() => {
      setQualityMode(quality.getMode());
      setTier(quality.tier);
    });
    return off;
  }, []);

  // 延迟校准（视觉 / 判定偏移）
  const [calib, setCalib] = useState<Calibration>(DEFAULT_CALIBRATION);
  useEffect(() => {
    setCalib(loadCalibration());
  }, []);
  const calibRef = useRef<Calibration>(calib);
  useEffect(() => {
    calibRef.current = calib;
  }, [calib]);
  const updateCalib = useCallback((patch: Partial<Calibration>) => {
    setCalib((c) => saveCalibration({ ...c, ...patch }));
  }, []);
  /** 跟拍校准状态 */
  const calibRunRef = useRef<{ startMs: number; beatMs: number; taps: number[] } | null>(null);
  const calibTimerRef = useRef<number | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibTaps, setCalibTaps] = useState(0);

  // 内置鼓音色（默认开启）
  const [kitOn, setKitOn] = useState(true);
  const kitOnRef = useRef(true);
  useEffect(() => {
    const on = loadKitEnabled();
    setKitOn(on);
    kitOnRef.current = on;
  }, []);
  const toggleKit = useCallback(() => {
    setKitOn((on) => {
      const next = !on;
      kitOnRef.current = next;
      saveKitEnabled(next);
      return next;
    });
  }, []);

  const layout = layoutOf(song.difficulty);
  const parts = VISIBLE_PARTS[layout];
  const durationMs = stemsDurationMs(stems) || (song.midi?.durationMs ?? 0);

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
  }, [song.midi, song.fileName, song.offsetMs, song.phaseBeatOffset, song.difficulty]);

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
    for (const kind of STEM_KINDS) songPlayer.setStemGain(kind, song.mix[kind]);
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

  /** 当前谱面时间（毫秒）：随时可读，不等下一帧，低帧率下判定也不被推迟 */
  const readTimeMs = useCallback(
    (now: number) => {
      const ph = phaseRef.current;
      // 倒计时与播放共用同一个时钟（音频时钟为准），从负数连续走到 0
      if (ph === "playing" || ph === "countdown") {
        return hasAudio ? songPlayer.timeMs() : now - silentStartRef.current;
      }
      if (ph === "idle") return 0;
      return timeRef.current;
    },
    [hasAudio],
  );

  // 击打：鼓音色 + 闪光 + 命中判定（空击只出声闪光，不惩罚）
  const hitPart = useCallback(
    (part: PartId, atMs?: number, velocity = 100) => {
      const now = performance.now();
      const at = atMs !== undefined && Number.isFinite(atMs) ? atMs : now;
      flashesRef.current[part] = now + FLASH_MS;
      if (kitOnRef.current) playDrum(part, velocity);
      // 跟拍校准中：只收集敲击时刻
      const run = calibRunRef.current;
      if (run) {
        run.taps.push(at);
        setCalibTaps(run.taps.length);
        return;
      }

      if (phaseRef.current !== "playing" || !playChart) return;
      // 敲击时刻 + 判定偏移（把设备链路延迟补回来）
      const t = readTimeMs(now) - (now - at) + calibRef.current.judgeMs;
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
      judgementRef.current = {
        text: perfect ? "PERFECT" : "GOOD",
        color: perfect ? "#ffd75e" : "#7dd3fc",
        until: now + 500,
      };
    },
    [playChart, readTimeMs],
  );

  // MIDI 击打（note-on 命中；左踏板另外跟踪按住 / 抬起）
  useEffect(() => {
    void midiManager.init();
    const offNote = midiManager.onNote((note, vel, atMs) => {
      const part = partOfNote(note);
      if (!part) return;
      if (part === "pedalHat") pedalHeldRef.current = true;
      if (parts.includes(part)) hitPart(part, atMs, vel);
    });

    const offUp = midiManager.onNoteOff((note) => {
      if (partOfNote(note) === "pedalHat") pedalHeldRef.current = false;
    });
    return () => {
      offNote();
      offUp();
    };
  }, [hitPart, parts]);

  // 键盘调试（无 MIDI 设备时）
  useEffect(() => {
    const pedalKey = KEY_BY_PART.pedalHat.key;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === pedalKey) pedalHeldRef.current = true;
      if (e.repeat) return;
      for (const [part, v] of Object.entries(KEY_BY_PART) as [PartId, { key: string }][]) {
        if (v.key === k && parts.includes(part)) {
          hitPart(part);
          return;
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === pedalKey) pedalHeldRef.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [hitPart, parts]);

  /** 校准结束：够 3 下就算偏差中位数写入判定偏移，否则原值不动 */
  const finishCalibration = useCallback(() => {
    if (calibTimerRef.current !== null) {
      window.clearInterval(calibTimerRef.current);
      calibTimerRef.current = null;
    }
    const run = calibRunRef.current;
    calibRunRef.current = null;
    setCalibrating(false);
    setCalibTaps(0);
    if (!run || run.taps.length < 3) return;
    const off = tapOffsetMs(run.taps, run.startMs, run.beatMs);
    setCalib((c) => saveCalibration({ ...c, judgeMs: -off }));
  }, []);

  /**
   * 跟拍校准：120BPM 节拍器一直响，直到敲满 8 下自动结束（也可手动停止），
   * 取偏差中位数写入判定偏移。
   */
  const startCalibration = useCallback(() => {
    if (calibRunRef.current) return;
    songPlayer.pause();
    const beatMs = 500;
    const target = 8;
    const startMs = performance.now() + 600;
    calibRunRef.current = { startMs, beatMs, taps: [] };
    setCalibrating(true);
    setCalibTaps(0);
    let beat = 0;
    const tick = () => {
      const run = calibRunRef.current;
      if (!run) return;
      // 敲满 8 下 → 结算（在下一拍到来时收工，保证最后一下也被记到）
      if (run.taps.length >= target) {
        finishCalibration();
        return;
      }
      metronomeClick(beat % 4 === 0);
      beat++;
    };
    timersRef.current.push(
      window.setTimeout(() => {
        if (!calibRunRef.current) return;
        tick();
        calibTimerRef.current = window.setInterval(tick, beatMs);
      }, 600),
    );
  }, [finishCalibration]);

  // 离开界面时确保校准节拍器停止
  useEffect(() => {
    return () => {
      if (calibTimerRef.current !== null) window.clearInterval(calibTimerRef.current);
    };
  }, []);

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
      timersRef.current.push(window.setTimeout(() => metronomeClick(i === 0), i * beatMs));
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

    // 长音符下标（左踏板踩住闭镲）
    const holdIndices: number[] = [];
    (playChart?.notes ?? []).forEach((n, i) => {
      if ((n.holdMs ?? 0) > 0) holdIndices.push(i);
    });

    let raf = 0;
    let last = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, quality.params.maxDpr);
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
      raf = requestAnimationFrame(draw);
      // 帧率上限（低档 30 帧）+ 帧时间采样喂给自动降档
      const dt = last ? now - last : 0;
      const minFrame = 1000 / quality.params.maxFps - 2;
      if (dt && dt < minFrame) return;
      last = now;
      quality.sample(dt, now);

      const ph = phaseRef.current;
      const t = readTimeMs(now);
      if (ph === "playing") {
        if (!hasAudio && playChart && t > playChart.durationMs) {
          phaseRef.current = "ended";
          setPhase("ended");
        }
      }
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

      // 长音符（左踏板踩住闭镲）：全程按住，中途松开立即判失误
      if (ph === "playing" && playChart) {
        const notes = playChart.notes;
        for (const i of holdIndices) {
          const n = notes[i]!;
          const end = n.timeMs + (n.holdMs ?? 0);
          if (t < n.timeMs || t > end) continue;
          if (holdStateRef.current[i] !== 1) continue;
          if (pedalHeldRef.current) continue;
          holdStateRef.current[i] = 2;
          statsRef.current.miss++;
          comboRef.current = 0;
          missFlashesRef.current["pedalHat"] = now + 240;
          judgementRef.current = { text: "MISS", color: "#f87171", until: now + 500 };
        }
      }

      const frameChart = playChart ?? {
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
                Math.ceil(
                  (countdownMsRef.current - (now - countdownStartRef.current)) / beatMsRef.current,
                ),
              ),
            )
          : null;

      const frame = {
        chart: frameChart,
        // 视觉偏移：只影响画面，不影响判定
        timeMs: t + calibRef.current.visualMs,
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
        // 未开始（idle）时不画音符，只显示鼓阵
        showNotes: ph !== "idle",

        // 宿主实时注入的鼓棒姿态（无数据时为 null，不绘制）
        sticks: stickManager.latest(),
      };

      renderStage(ctx, canvas.clientWidth, canvas.clientHeight, frame);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [playChart, speed, parts, hasAudio, readTimeMs, tier]);

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

        {/* 可开关的调试打印小窗 */}
        <DebugLogPanel />

        {/* 空态 / 开始 / 暂停 / 结算遮罩 */}
        {!song.midi && (
          <Overlay>
            <p className="text-sm text-white/80">还没有谱面</p>
            <p className="text-xs text-white/50">请先到「谱面」屏导入去鼓伴奏音频与对应的鼓 MIDI</p>
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

      {/* 调音台：四轨常驻，100% = 原始文件音量 */}
      <div
        className="mx-auto w-full border border-[var(--taiko-line)] bg-[var(--taiko-surface)] px-4 py-3"
        style={{ maxWidth: "calc(min(70vh, 720px) * 16 / 9)" }}
      >
        <div className="mb-2 flex items-baseline gap-3">
          <span className="text-xs tracking-[0.2em] text-[var(--taiko-accent)]">调音台</span>
          <span className="text-[10px] text-[var(--taiko-ink)]/45">100% = 原始文件音量</span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          {STEM_KINDS.map((key) => {
            const track = stems[key];
            const value = song.mix[key];
            return (
              <label key={key} className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-[11px] text-[var(--taiko-ink)]/70">
                  <span className={track ? "" : "text-[var(--taiko-ink)]/35"}>
                    {STEM_LABEL[key]}
                    {track ? "" : "（无此轨）"}
                  </span>
                  <span className="tabular-nums text-[var(--taiko-ink)]/55">
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
                  className="h-1 w-full cursor-pointer appearance-none rounded bg-[var(--taiko-ink)]/25 accent-[var(--taiko-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                />
              </label>
            );
          })}
        </div>
      </div>

      {/* 性能与手感：画质档位 + 延迟校准 */}
      <div
        className="mx-auto w-full border border-[var(--taiko-line)] bg-[var(--taiko-surface)] px-4 py-3"
        style={{ maxWidth: "calc(min(70vh, 720px) * 16 / 9)" }}
      >
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <span className="text-xs tracking-[0.2em] text-[var(--taiko-accent)]">画质</span>
          {(["auto", "high", "medium", "low"] as QualityMode[]).map((m) => (
            <button
              key={m}
              onClick={() => quality.setMode(m)}
              className={`-ml-px border border-[var(--taiko-line)] px-3 py-1 text-xs transition-colors first:ml-0 ${
                qualityMode === m
                  ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                  : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
              }`}
            >
              {TIER_LABEL[m]}
            </button>
          ))}
          <span className="text-[10px] text-[var(--taiko-ink)]/45">
            当前实际：{TIER_LABEL[tier]}（卡顿时自动降档）
          </span>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
          {(
            [
              ["visualMs", "音符视觉偏移"],
              ["judgeMs", "判定偏移"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-[11px] text-[var(--taiko-ink)]/70">
                <span>{label}</span>
                <span className="tabular-nums text-[var(--taiko-ink)]/55">
                  {calib[key] > 0 ? "+" : ""}
                  {calib[key]} ms
                </span>
              </span>
              <input
                type="range"
                min={-CALIB_RANGE}
                max={CALIB_RANGE}
                step={1}
                value={calib[key]}
                onChange={(e) => updateCalib({ [key]: Number(e.target.value) })}
                className="h-1 w-full cursor-pointer appearance-none rounded bg-[var(--taiko-ink)]/25 accent-[var(--taiko-accent)]"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={calibrating ? finishCalibration : startCalibration}
            disabled={!calibrating && phase === "playing"}
            className="border border-[var(--taiko-line)] px-3 py-1.5 text-xs text-[var(--taiko-ink)]/80 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {calibrating ? `停止校准（${calibTaps}/8）` : "自动校准"}
          </button>
          <span className="text-[10px] text-[var(--taiko-ink)]/45">
            节拍器会一直响，跟着敲 8 下自动算出你这台机器的延迟，也可随时停止
          </span>

          <span className="mx-1 h-5 w-px bg-[var(--taiko-line)]" />
          <button
            onClick={toggleKit}
            className={`border px-3 py-1.5 text-xs transition-colors ${
              kitOn
                ? "border-[var(--taiko-ink)] bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
            }`}
          >
            鼓音色 {kitOn ? "开" : "关"}
          </button>
          <span className="text-[10px] text-[var(--taiko-ink)]/45">内置鼓音色，敲击即出声</span>
        </div>
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
