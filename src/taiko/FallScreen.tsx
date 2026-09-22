import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PART_BY_ID, VISIBLE_PARTS, partOfNote, type PartId } from "./laneLayouts";
import { renderStage } from "./stageRenderer";
import { useSong } from "./songStore";
import { songPlayer } from "./player";
import { STEM_KINDS, STEM_LABEL, hasAnyStem, stemsDurationMs } from "./stems";
import { midiManager } from "./midiInput";
import { stickManager } from "./stickInput";
import { DebugLogPanel } from "./DebugLogPanel";
import { click as metronomeClick, getAudioContext } from "./metronome";
import { loadKitEnabled, playDrum, warmUpDrums } from "./drumKit";
import { latencyMeter } from "./latencyMeter";
import { debugLog } from "./debugLog";
import { HelpDot } from "@/components/HelpDot";
import { helpText } from "./helpTexts";
import { useLanguage } from "./i18n";
import { SongPicker } from "./SongPicker";
import { SlidersHorizontal, X } from "lucide-react";
import { GlobalSettings } from "./GlobalSettings";


import { DIFFICULTIES, layoutOf } from "./difficulty";
import { getPlayChart } from "./chartCache";
import { shiftChart } from "@/shared/taikoChart";

import { quality, type QualityTier } from "./perf";
import { FpsBadge } from "./FpsBadge";
import { DEFAULT_CALIBRATION, loadCalibration, type Calibration } from "./calibration";
import { addHistory } from "./history";

const FLASH_MS = 200;
/** 判定窗口：Perfect ±100ms / Good ±200ms，超时未击为 Miss（调手感改这里） */
const PERFECT_MS = 100;
const GOOD_MS = 200;
/** 击打迟到超过这个毫秒数就只出声不参与判定 */
const LATE_INPUT_LIMIT_MS = 400;
/** 倒计时拍数（四分音符，无视拍号） */
const COUNT_IN_BEATS = 4;

type Phase = "idle" | "countdown" | "playing" | "paused" | "ended";

export function FallScreen({
  speed,
  suspended = false,
  onSpeedChange,
  onExit,
}: {
  speed: number;
  suspended?: boolean;
  onSpeedChange?: ((s: number) => void) | undefined;
  onExit?: (() => void) | undefined;
}) {
  const { tr, language } = useLanguage();
  const song = useSong();
  const { stems } = song;
  const hasAudio = hasAnyStem(stems);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [mixerOpen, setMixerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);


  const phaseRef = useRef<Phase>("idle");
  const timeRef = useRef(0);
  const flashesRef = useRef<Record<string, number>>({});
  const missFlashesRef = useRef<Record<string, number>>({});
  const judgementRef = useRef<{ text: string; color: string; until: number } | null>(null);
  /** 0 未判定 / 1 命中 / 2 Miss */
  const judgedRef = useRef<Uint8Array>(new Uint8Array(0));
  /** 长音符（左踏板踩住闭镲）状态：0 未开始 / 1 按住中 / 2 已断开或结算 */
  const holdStateRef = useRef<Uint8Array>(new Uint8Array(0));
  /** 左踏板当前是否被踩住（MIDI note-off 抬起） */
  const pedalHeldRef = useRef(false);
  const statsRef = useRef({ perfect: 0, good: 0, miss: 0 });
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const scoreRef = useRef(0);
  const missCursorRef = useRef(0);
  /** 鼓件 → 该鼓件音符下标（按时间升序），判定时只在时间窗附近二分查找 */
  const noteIndexRef = useRef<Partial<Record<PartId, number[]>>>({});
  const timersRef = useRef<number[]>([]);
  const countdownStartRef = useRef(0);
  const countdownMsRef = useRef(0);
  const beatMsRef = useRef(500);
  /** 无音频（仅 MIDI）静音试玩时的起始时刻 */
  const silentStartRef = useRef(0);
  /** 本局是否真正开始演奏过（用于中途退出也记历史） */
  const playedRef = useRef(false);

  // 画质档位（在谱面页设置；tier 变化时重设画布分辨率）
  const [tier, setTier] = useState<QualityTier>("high");
  useEffect(() => {
    quality.hydrate();
    setTier(quality.tier);
    return quality.subscribe(() => setTier(quality.tier));
  }, []);

  // 偏移与鼓音色（在谱面页设置，进入本页时读取）
  const calibRef = useRef<Calibration>(DEFAULT_CALIBRATION);
  const kitOnRef = useRef(true);
  useEffect(() => {
    calibRef.current = loadCalibration();
    kitOnRef.current = loadKitEnabled();
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

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // 谱面变化时重建判定索引（按鼓件分组，沿用谱面本身的时间升序）
  useEffect(() => {
    const map: Partial<Record<PartId, number[]>> = {};
    const notes = playChart?.notes ?? [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]!;
      if (n.note === undefined) continue;
      const p = partOfNote(n.note);
      if (!p) continue;
      (map[p] ??= []).push(i);
    }
    noteIndexRef.current = map;
  }, [playChart]);


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

  // 音频装载 / 卸载（开头空白统一跳过）
  useEffect(() => {
    songPlayer.setLeadMs(song.audioLeadMs);
    songPlayer.load(stems);
    setPhaseBoth("idle");
    return () => songPlayer.stop();
  }, [stems, song.audioLeadMs, setPhaseBoth]);

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
    (part: PartId, atMs?: number, velocity = 100, note?: number) => {
      const now = performance.now();
      const at = atMs !== undefined && Number.isFinite(atMs) ? atMs : now;
      // 抖动量表：真实敲击时刻 → 网页实际处理时刻
      if (atMs !== undefined && Number.isFinite(atMs)) latencyMeter.recordInput(now - atMs);
      flashesRef.current[part] = now + FLASH_MS;
      if (kitOnRef.current) playDrum(part, velocity, undefined, note);

      if (phaseRef.current !== "playing" || !playChart) return;
      // 宿主偶发卡顿会把一批击打迟送过来；明显超窗的只出声不判定，
      // 避免用一个错误时刻去命中/顶掉附近的音符。
      if (now - at > LATE_INPUT_LIMIT_MS) {
        debugLog.push("midi", `击打迟到 ${Math.round(now - at)}ms，只出声不判定`);
        return;
      }
      // 敲击时刻 + 判定偏移（把设备链路延迟补回来）
      const t = readTimeMs(now) - (now - at) + calibRef.current.judgeMs;
      const notes = playChart.notes;
      // 只在该鼓件的时间窗附近查找（二分定位），不再遍历整首曲子
      const idx = noteIndexRef.current[part];
      let best = -1;
      let bestDiff = Infinity;
      if (idx && idx.length) {
        const lo = t - GOOD_MS;
        let a = 0;
        let b = idx.length;
        while (a < b) {
          const m = (a + b) >> 1;
          if (notes[idx[m]!]!.timeMs < lo) a = m + 1;
          else b = m;
        }
        for (let k = a; k < idx.length; k++) {
          const i = idx[k]!;
          const n = notes[i]!;
          if (n.timeMs > t + GOOD_MS) break;
          if (judgedRef.current[i]) continue;
          const diff = Math.abs(n.timeMs - t);
          if (diff < bestDiff) {
            best = i;
            bestDiff = diff;
          }
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
        text: perfect ? tr("完美", "PERFECT") : tr("良好", "GOOD"),
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
      if (parts.includes(part)) hitPart(part, atMs, vel, note);
    });

    const offUp = midiManager.onNoteOff((note) => {
      if (partOfNote(note) === "pedalHat") pedalHeldRef.current = false;
    });
    return () => {
      offNote();
      offUp();
    };
  }, [hitPart, parts]);

  // 手动开始 → 4 拍倒计时（四分音符）→ 播放
  const start = useCallback(() => {
    if (!playChart || playChart.notes.length === 0) return;
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    resetRun();
    playedRef.current = true;
    latencyMeter.reset();
    // 倒计时那 4 拍里把鼓组样本与音频节点热起来，避免首次敲某个鼓时才解码
    if (kitOnRef.current) void warmUpDrums();
    const beatMs = 60000 / playChart.bpm;
    beatMsRef.current = beatMs;
    const countdownMs = COUNT_IN_BEATS * beatMs;
    countdownMsRef.current = countdownMs;
    // 一次算好歌曲的绝对起播时刻，倒计时由同一时钟倒推 → 切换时不跳位
    const ctx = getAudioContext();
    const LEAD_SEC = 0.15;
    const songStartSec = ctx.currentTime + LEAD_SEC + countdownMs / 1000;
    countdownStartRef.current = performance.now();
    timeRef.current = -countdownMs;
    if (hasAudio) songPlayer.play(0, songStartSec);
    else silentStartRef.current = performance.now() + LEAD_SEC * 1000 + countdownMs;
    setPhaseBoth("countdown");
    // 倒计时滴答挂在同一条音频时间轴上
    for (let i = 0; i < COUNT_IN_BEATS; i++) {
      metronomeClick(i === 0, songStartSec - countdownMs / 1000 + (i * beatMs) / 1000);
    }
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

  // 打开谱面、映射或位置捕捉覆盖窗时只负责暂停，不自动续播。
  useEffect(() => {
    if (suspended && phaseRef.current === "playing") togglePause();
  }, [suspended, togglePause]);

  // Unity 把 H5 切后台/锁屏时自动暂停（rAF 后台本就不走，这里把音频也停下）
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && phaseRef.current === "playing") togglePause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [togglePause]);

  // 演奏中申请屏幕常亮：安卓息屏后系统更容易回收整个 WebView
  useEffect(() => {
    if (phase !== "playing" && phase !== "countdown") return;
    type WakeLockSentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    nav.wakeLock
      .request("screen")
      .then((s) => {
        if (cancelled) void s.release().catch(() => {});
        else {
          sentinel = s;
          debugLog.push("host", "已申请屏幕常亮");
        }
      })
      .catch(() => {
        // 宿主未授权则忽略，交给安卓外壳设置 FLAG_KEEP_SCREEN_ON
      });
    return () => {
      cancelled = true;
      void sentinel?.release().catch(() => {});
    };
  }, [phase]);

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
      latencyMeter.recordFrame(dt);

      let ph = phaseRef.current;
      const t = readTimeMs(now);
      // 倒计时走到 0 → 直接进入演奏（时钟不重设，音符不跳位）
      if (ph === "countdown" && t >= 0) {
        ph = "playing";
        phaseRef.current = "playing";
        setPhase("playing");
      }
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
            judgementRef.current = { text: tr("失误", "MISS"), color: "#f87171", until: now + 500 };
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
          judgementRef.current = { text: tr("失误", "MISS"), color: "#f87171", until: now + 500 };
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
          ? String(Math.min(COUNT_IN_BEATS, Math.max(1, Math.ceil(-t / beatMsRef.current))))
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

  /** 写一条本机历史演奏（同一局只写一次） */
  const recordRun = useCallback(
    (completed: boolean) => {
      if (!playedRef.current || !song.fileName) return;
      playedRef.current = false;
      const s = statsRef.current;
      const total = s.perfect + s.good + s.miss;
      const dur = durationMs;
      const progress = completed
        ? 100
        : dur > 0
          ? Math.max(0, Math.min(100, (timeRef.current / dur) * 100))
          : 0;
      addHistory({
        songId: song.songId,
        title: song.fileName,
        difficulty: song.difficulty,
        speed,
        accuracy: total > 0 ? ((s.perfect + s.good * 0.5) / total) * 100 : 0,
        maxCombo: maxComboRef.current,
        notes: total,
        completed,
        progress: Math.round(progress),
        playedAt: Date.now(),
      });
    },
    [song.songId, song.fileName, song.difficulty, speed, durationMs],
  );

  // 一曲结束 → 记一条完整记录
  useEffect(() => {
    if (phase !== "ended") return;
    recordRun(true);
    // 只在结束的那一刻记录
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /** 中途返回选歌：先记一条未完成记录 */
  const backToPicker = useCallback(() => {
    recordRun(false);
    songPlayer.stop();
    setPhaseBoth("idle");
  }, [recordRun, setPhaseBoth]);

  return (
    // 演奏区吃满整个窗口；调音台收进左下角抽屉
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[var(--taiko-paper)]">
      <div ref={wrapRef} className="relative h-full min-h-0 overflow-hidden bg-[var(--taiko-paper)]">
        <canvas ref={canvasRef} className="block h-full w-full" />

        {/* 演奏区实测帧数 */}
        {phase !== "idle" && <FpsBadge />}

        {/* 可开关的调试打印小窗 */}
        <DebugLogPanel />

        {/* 顶部右侧：暂停按钮放在画布曲名/BPM 下方，避免重叠 */}
        {(phase === "playing" || phase === "countdown") && (
          <div className="absolute right-3 top-16 z-10 flex flex-col items-end gap-2">
            <span className="hidden text-right text-xs leading-tight text-[rgba(255,255,255,0.6)] lg:block">
              {tr("速度", "Speed")} {speed}x · {tr("难度", "Difficulty")}{" "}
              {(() => {
                const d = DIFFICULTIES.find((d) => d.id === song.difficulty);
                return d ? tr(d.label, d.labelEn) : "";
              })()}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={togglePause}
                className="rounded-md bg-[rgba(255,255,255,0.14)] px-4 py-1.5 text-xs text-[rgba(255,255,255,0.92)] transition-colors hover:bg-[rgba(255,255,255,0.26)]"
              >
                {tr("暂停", "Pause")}
              </button>
              <HelpDot label={tr("游玩", "Play")} text={helpText("play", language)} />
            </div>
          </div>
        )}

        {/* 左下角抽屉式调音台（选歌时隐藏，保持选歌层干净） */}
        {phase !== "idle" && <div className="absolute bottom-3 left-3 z-30">

          {mixerOpen && (
            <div className="mb-2 w-[min(78vw,420px)] bg-[rgba(10,12,18,0.82)] px-4 py-3 backdrop-blur-[8px]">
              <div className="mb-2 flex items-baseline gap-3">
                <span className="text-xs tracking-[0.2em] text-[var(--taiko-accent)]">
                  {tr("调音台", "Mixer")}
                </span>
                <span className="text-[10px] text-[rgba(255,255,255,0.45)]">
                  {tr("100% = 原始文件音量", "100% = original file volume")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                {STEM_KINDS.map((key) => {
                  const track = stems[key];
                  const value = song.mix[key];
                  return (
                    <label key={key} className="flex min-w-0 flex-col gap-1">
                      <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 text-[10px] text-[rgba(255,255,255,0.7)]">
                        <span className={`truncate ${track ? "" : "opacity-40"}`}>
                          {STEM_LABEL[key]}
                          {track ? "" : tr("（无）", " (none)")}
                        </span>
                        <span className="tabular-nums text-[rgba(255,255,255,0.55)]">
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
                          song.setSong({ mix: { ...song.mix, [key]: Number(e.target.value) / 100 } })
                        }
                        className="h-1.5 w-full cursor-pointer appearance-none rounded bg-[rgba(255,255,255,0.25)] accent-[var(--taiko-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setMixerOpen((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] transition-colors ${
              mixerOpen
                ? "bg-[var(--taiko-accent)] text-[#12141a]"
                : "bg-[rgba(10,12,18,0.7)] text-[rgba(255,255,255,0.75)] hover:bg-[rgba(10,12,18,0.9)]"
            }`}
          >
            <SlidersHorizontal size={13} />
            {tr("调音台", "Mixer")}
          </button>
        </div>}


        {/* 选歌层：未开始时覆盖在虚化的舞台上 */}
        {phase === "idle" && (
          <SongPicker
            speed={speed}
            onSpeedChange={onSpeedChange}
            onStart={start}
            onOpenSettings={() => setSettingsOpen(true)}
            onExit={onExit}
          />
        )}

        {phase === "idle" && settingsOpen && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--taiko-modal-scrim)] p-4 backdrop-blur-[18px]"
            role="dialog"
            aria-modal="true"
            aria-label={tr("全局设置", "Global settings")}
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setSettingsOpen(false);
            }}
          >
            <div className="taiko-scroll max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-[var(--taiko-glass-line)] bg-[var(--taiko-glass-strong)] p-3 shadow-2xl backdrop-blur-[24px]">
              <div className="mb-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label={tr("关闭设置", "Close settings")}
                  className="grid h-8 w-8 place-items-center rounded-md border border-[var(--taiko-line)] text-[var(--taiko-ink)]/75 transition-colors hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
                >
                  <X size={16} />
                </button>
              </div>
              <GlobalSettings speed={speed} onSpeedChange={(next) => onSpeedChange?.(next)} />
            </div>
          </div>
        )}

        {phase === "paused" && (
          <Overlay>
            <p className="text-lg tracking-[0.3em] text-white">{tr("已暂停", "PAUSED")}</p>
            <div className="flex gap-3">
              <button
                onClick={togglePause}
                className="border border-white/70 px-6 py-2 text-sm text-white transition-colors hover:bg-white hover:text-black"
              >
                {tr("继续", "Resume")}
              </button>
              <button
                onClick={start}
                className="border border-white/30 px-6 py-2 text-sm text-white/70 transition-colors hover:border-white/70 hover:text-white"
              >
                {tr("重新开始", "Restart")}
              </button>
              <button
                onClick={backToPicker}
                className="border border-white/30 px-6 py-2 text-sm text-white/70 transition-colors hover:border-white/70 hover:text-white"
              >
                {tr("选择歌曲", "Songs")}
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
              {tr("最大连击", "Max combo")} {maxComboRef.current} · {tr("准确率", "Accuracy")} {acc.toFixed(1)}%
            </p>
            <p className="text-xs tabular-nums text-white/50">
              Perfect {judged.perfect} · Good {judged.good} · Miss {judged.miss}
            </p>
            <div className="mt-2 flex gap-3">
              <button
                onClick={start}
                className="border border-white/70 px-8 py-2 text-sm tracking-[0.2em] text-white transition-colors hover:bg-white hover:text-black"
              >
                {tr("再来一次", "Retry")}
              </button>
              <button
                onClick={backToPicker}
                className="border border-white/30 px-8 py-2 text-sm tracking-[0.2em] text-white/70 transition-colors hover:border-white/70 hover:text-white"
              >
                {tr("选择歌曲", "Songs")}
              </button>
            </div>
          </Overlay>
        )}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/55">
      {children}
    </div>
  );
}

