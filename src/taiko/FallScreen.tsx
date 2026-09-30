import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PART_BY_ID, VISIBLE_PARTS, partOfNote, type PartId } from "./laneLayouts";
import { renderStage } from "./stageRenderer";
import { renderColumns } from "./columnRenderer";
import { loadViewMode, subscribeViewMode, type ViewMode } from "./viewMode";
import { musicGain, useSong } from "./songStore";
import { songPlayer } from "./player";
import { STEM_KINDS, hasAnyStem, stemsDurationMs } from "./stems";
import { midiManager } from "./midiInput";
import { stickManager } from "./stickInput";
import { gestureHitDetector, noteOfPart } from "./gestureHit";

import { DebugLogPanel } from "./DebugLogPanel";
import { click as metronomeClick, getAudioContext, unlockAudio } from "./metronome";
import { loadKitEnabled, playDrum, subscribeKitEnabled, warmUpDrums } from "./drumKit";
import { latencyMeter } from "./latencyMeter";
import { debugLog } from "./debugLog";
import { useLanguage } from "./i18n";
import { SongPicker } from "./SongPicker";
import { Pause, Settings, X } from "lucide-react";
import { GlobalSettings } from "./GlobalSettings";
import { Button } from "@/components/ui/button";


import { DIFFICULTIES, layoutOf } from "./difficulty";
import { getPlayChart } from "./chartCache";
import { shiftChart } from "@/shared/taikoChart";

import { quality, type QualityTier } from "./perf";
import { DEFAULT_CALIBRATION, loadCalibration, type Calibration } from "./calibration";
import { addHistory } from "./history";
import { TutorialOverlay, markTutorialSeen } from "./tutorial/TutorialOverlay";
import { ratingOfAccuracy } from "./rating";

const FLASH_MS = 200;
/** 判定窗口：Perfect ±100ms / Good ±200ms，超时未击为 Miss（调手感改这里） */
const PERFECT_MS = 100;
const GOOD_MS = 200;
/** 击打迟到超过这个毫秒数就只出声不参与判定 */
const LATE_INPUT_LIMIT_MS = 400;
/** 调试窗默认隐藏：URL 带 ?debug=1 或宿主设 window.__pd2uDebug=true 才显示 */
function debugVisible(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as unknown as { __pd2uDebug?: boolean }).__pd2uDebug === true) return true;
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}

type Phase = "idle" | "countdown" | "playing" | "paused" | "ended";

export function FallScreen({
  speed,
  suspended = false,
  onSpeedChange,
  onExit,
  gestureHits = false,
  exitLabel,
  onSecretUnlock,
}: {
  speed: number;
  suspended?: boolean;
  onSpeedChange?: ((s: number) => void) | undefined;
  onExit?: (() => void) | undefined;
  /** 实验版：手部七个鼓面改由鼓棒角度判定，踏板仍走 MIDI */
  gestureHits?: boolean;
  exitLabel?: string | undefined;
  onSecretUnlock?: (() => void) | undefined;
}) {

  const { tr } = useLanguage();
  const song = useSong();
  const { stems } = song;
  const hasAudio = hasAnyStem(stems);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  const phaseRef = useRef<Phase>("idle");
  const timeRef = useRef(0);
  const flashesRef = useRef<Record<string, number>>({});
  const missFlashesRef = useRef<Record<string, number>>({});
  const judgementRef = useRef<{ text: string; color: string; until: number } | null>(null);
  /** 0 未判定 / 1 命中 / 2 Miss */
  const judgedRef = useRef<Uint8Array>(new Uint8Array(0));
  /** 单音符判定发生时刻，用于横排命中遮盖与渐隐。 */
  const judgedAtRef = useRef<Float64Array>(new Float64Array(0));
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
  const countdownBeatsRef = useRef(4);
  const countdownTargetRef = useRef(0);
  /** 每次开始递增，异步唤醒完成后只允许当前一轮安排音频。 */
  const countdownRunRef = useRef(0);
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
    return subscribeKitEnabled((on) => { kitOnRef.current = on; });
  }, []);

  // 视觉模式：舞台下落式 / 横排下落式（横排始终显示全部 9 个部件）
  const [viewMode, setViewModeState] = useState<ViewMode>("columns");
  useEffect(() => {
    setViewModeState(loadViewMode());
    return subscribeViewMode(setViewModeState);
  }, []);

  const layout = layoutOf(song.difficulty);
  const parts = viewMode === "columns" ? VISIBLE_PARTS.nine : VISIBLE_PARTS[layout];
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
      // 开头空白 + 第一声鼓真实咬合，两者一起平移
      song.audioLeadMs + song.audioAlignMs,
    );
  }, [
    song.midi,
    song.fileName,
    song.offsetMs,
    song.phaseBeatOffset,
    song.difficulty,
    song.audioLeadMs,
    song.audioAlignMs,
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
    judgedAtRef.current = new Float64Array(playChart?.notes.length ?? 0);
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
    const g = musicGain(song.mix.music);
    for (const kind of STEM_KINDS) songPlayer.setStemGain(kind, kind === "drums" ? 0 : g);
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
        if (ph === "countdown") {
          return countdownTargetRef.current - countdownMsRef.current + (now - countdownStartRef.current);
        }
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
      if (kitOnRef.current) playDrum(part, velocity, undefined, note, at);

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
      judgedAtRef.current[best] = now;
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

  // 击打入口放进 ref：订阅（MIDI / 角度判定）只挂一次，歌曲播放中界面重渲染
  // 不会反复重启角度判定器——重启会清空正在累计的挥棒轨迹，导致进歌后打不响。
  const hitPartRef = useRef(hitPart);
  hitPartRef.current = hitPart;

  // MIDI 击打（note-on 命中；左踏板另外跟踪按住 / 抬起）
  // 实验版（gestureHits）里手部鼓面交给角度判定，MIDI 只负责两个踏板。
  useEffect(() => {
    void midiManager.init();
    unlockAudio(); // iOS/WKWebView：首次手势里接通音频输出，避免第一批敲击抖动
    const offNote = midiManager.onNote((note, vel, atMs) => {
      const part = partOfNote(note);
      if (!part) return;
      const isPedal = part === "pedalHat" || part === "kick";
      if (part === "pedalHat") pedalHeldRef.current = true;
      if (gestureHits && !isPedal) return;
      if (parts.includes(part)) {
        stickManager.switchLayerForHit(part, parts);
        hitPartRef.current(part, atMs, vel, note);
      }
    });

    const offUp = midiManager.onNoteOff((note) => {
      if (partOfNote(note) === "pedalHat") pedalHeldRef.current = false;
    });
    return () => {
      offNote();
      offUp();
    };
  }, [parts, gestureHits]);

  // 实验版：角度触发手部击打（快速下探 → 触底停住的那一帧立刻出声判定）
  useEffect(() => {
    if (!gestureHits) return;
    return gestureHitDetector.start((hit) => {
      if (!parts.includes(hit.part)) return;
      stickManager.switchLayerForHit(hit.part, parts);
      hitPartRef.current(hit.part, hit.atMs, hit.velocity, noteOfPart(hit.part));
    }, { parts });
  }, [gestureHits, parts]);


  // 开始、重开、暂停后继续共用：按拍号分子倒数，再从指定位置播放。
  const beginCountdown = useCallback((fromMs: number, reset: boolean) => {
    if (!playChart || playChart.notes.length === 0) return;
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    if (reset) {
      resetRun();
      playedRef.current = true;
      latencyMeter.reset();
      stickManager.resetLayers();
    }
    // 倒计时期间把鼓组样本与音频节点热起来，避免首次敲某个鼓时才解码
    if (kitOnRef.current) void warmUpDrums();
    const beatMs = 60000 / playChart.bpm;
    const beats = Math.max(1, Math.round(playChart.timeSignature[0] || 4));
    beatMsRef.current = beatMs;
    countdownBeatsRef.current = beats;
    const countdownMs = beats * beatMs;
    countdownMsRef.current = countdownMs;
    countdownTargetRef.current = fromMs;
    const run = ++countdownRunRef.current;
    const LEAD_MS = 80;
    countdownStartRef.current = performance.now() + LEAD_MS;
    timeRef.current = fromMs - countdownMs;
    setPhaseBoth("countdown");

    // 倒计时使用页面单调时钟；声音唤醒后按剩余时间安排到同一个终点。
    const ctx = getAudioContext();
    const scheduleAudio = () => {
      if (run !== countdownRunRef.current || phaseRef.current !== "countdown") return;
      const remainingMs = Math.max(0, countdownStartRef.current + countdownMs - performance.now());
      if (hasAudio) songPlayer.play(fromMs, ctx.currentTime + Math.max(0.02, remainingMs / 1000));
    };
    if (ctx.state === "running") scheduleAudio();
    else void ctx.resume().then(scheduleAudio).catch(() => undefined);
    if (!hasAudio) silentStartRef.current = countdownStartRef.current + countdownMs - fromMs;
    // 倒计时滴答挂在同一条音频时间轴上
    for (let i = 0; i < beats; i++) {
      metronomeClick(i === 0, ctx.currentTime + LEAD_MS / 1000 + (i * beatMs) / 1000);
    }
  }, [hasAudio, playChart, resetRun, setPhaseBoth]);

  // 重试与兜底都通过 ref 调用最新的 beginCountdown，避免闭包里递归引用自身
  const beginCountdownRef = useRef(beginCountdown);
  beginCountdownRef.current = beginCountdown;


  const start = useCallback(() => beginCountdown(0, true), [beginCountdown]);

  const pause = useCallback(() => {
    if (phaseRef.current === "playing" || phaseRef.current === "countdown") {
      countdownRunRef.current++;
      const current = readTimeMs(performance.now());
      // 倒计时中暂停后，从目标位置重新按完整拍号倒数，避免恢复到半拍。
      timeRef.current = phaseRef.current === "countdown"
        ? Math.max(0, countdownTargetRef.current)
        : current;
      if (hasAudio) songPlayer.pause();
      setPhaseBoth("paused");
    }
  }, [hasAudio, readTimeMs, setPhaseBoth]);

  const resume = useCallback(
    () => beginCountdown(Math.max(0, timeRef.current), false),
    [beginCountdown],
  );

  // 打开谱面、映射或位置捕捉覆盖窗时只负责暂停，不自动续播。
  useEffect(() => {
    if (suspended && (phaseRef.current === "playing" || phaseRef.current === "countdown")) pause();
  }, [suspended, pause]);

  // Unity 把 H5 切后台/锁屏时自动暂停（rAF 后台本就不走，这里把音频也停下）
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && (phaseRef.current === "playing" || phaseRef.current === "countdown")) pause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pause]);

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
          debugLog.push("system", "已申请屏幕常亮");
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
      if (e.key === " " && (phaseRef.current === "playing" || phaseRef.current === "countdown" || phaseRef.current === "paused")) {
        e.preventDefault();
        if (phaseRef.current === "playing" || phaseRef.current === "countdown") pause();
        else resume();
      } else if (
        e.key === "Enter" &&
        (phaseRef.current === "idle" || phaseRef.current === "ended")
      ) {
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pause, resume, start]);

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
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    if (ro) ro.observe(wrap);
    else window.addEventListener("resize", resize);

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
      // 倒计时走到目标位置 → 直接进入演奏（时钟不重设，音符不跳位）
      if (ph === "countdown" && t >= countdownTargetRef.current) {
        if (hasAudio && !songPlayer.playing) {
          void getAudioContext().resume().catch(() => undefined);
          songPlayer.play(Math.max(0, countdownTargetRef.current));
        }
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
            judgedAtRef.current[c] = now;
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

      // 舞台模式保留左踏板长按；横排模式只把起点当作一次 Foot 踩击。
      if (ph === "playing" && playChart && viewMode !== "columns") {
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
          ? String(
              Math.min(
                countdownBeatsRef.current,
                Math.max(1, Math.ceil((countdownTargetRef.current - t) / beatMsRef.current)),
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
        noteJudgements: judgedRef.current,
        noteJudgementAt: judgedAtRef.current,
        combo: comboRef.current,
        score: scoreRef.current,
        parts,
        judgement: judgementRef.current,
        countText,
        stats: statsRef.current,
        rating:
          statsRef.current.perfect + statsRef.current.good + statsRef.current.miss > 0
            ? ratingOfAccuracy(
                ((statsRef.current.perfect + statsRef.current.good * 0.5) /
                  (statsRef.current.perfect + statsRef.current.good + statsRef.current.miss)) *
                  100,
                {
                  progress: frameChart.durationMs > 0 ? (t / frameChart.durationMs) * 100 : 0,
                  completed: ph === "ended",
                  fullCombo: ph === "ended" && statsRef.current.miss === 0,
                },
              )
            : null,
        // 未开始（idle）时不画音符，只显示鼓阵
        showNotes: ph !== "idle",
        audioEnergy: viewMode === "columns" ? songPlayer.audioEnergy() : 0,
        motionActive: ph === "playing" || ph === "countdown",

        // 宿主实时注入的鼓棒姿态（无数据时为 null，不绘制）
        sticks: stickManager.latest(),
      };

      if (viewMode === "columns") {
        renderColumns(ctx, canvas.clientWidth, canvas.clientHeight, frame);
      } else {
        renderStage(ctx, canvas.clientWidth, canvas.clientHeight, frame);
      }
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      if (!ro) window.removeEventListener("resize", resize);
    };
  }, [playChart, speed, parts, hasAudio, readTimeMs, tier, viewMode]);

  const judged = statsRef.current;
  const totalJudged = judged.perfect + judged.good + judged.miss;
  const acc = totalJudged > 0 ? ((judged.perfect + judged.good * 0.5) / totalJudged) * 100 : 0;

  /** 写一条本机历史演奏（同一局只写一次） */
  const [resultRank, setResultRank] = useState<{ newBest: boolean; rank: number | null } | null>(null);
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
      void addHistory({
        songId: song.songId,
        title: song.fileName,
        difficulty: song.difficulty,
        speed,
        score: scoreRef.current,
        accuracy: total > 0 ? ((s.perfect + s.good * 0.5) / total) * 100 : 0,
        maxCombo: maxComboRef.current,
        notes: total,
        completed,
        fullCombo: completed && total > 0 && s.miss === 0,
        progress: Math.round(progress),
        playedAt: Date.now(),
      }).then((r) => {
        if (completed) setResultRank(r);
      });
    },
    [song.songId, song.fileName, song.difficulty, speed, durationMs],
  );

  // 一曲结束 → 记一条完整记录
  useEffect(() => {
    if (phase !== "ended") {
      setResultRank(null);
      return;
    }
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

        {/* 帧数与调试日志默认隐藏，仅 ?debug=1 或 __pd2uDebug 时出现 */}
        {debugVisible() && <DebugLogPanel />}

        {/* 全局设置始终固定左上角；演奏/倒计时中打开时先安全暂停。 */}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => {
            if (phaseRef.current === "playing" || phaseRef.current === "countdown") pause();
            setSettingsOpen(true);
          }}
          aria-label={tr("全局设置", "Global settings")}
          title={tr("全局设置", "Global settings")}
          className="taiko-global-settings absolute left-3 top-3 z-[60] h-9 w-9 rounded-md border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] text-[rgba(255,255,255,0.76)] backdrop-blur-[18px] hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
        >
          <Settings size={16} />
        </Button>

        {/* 顶部右侧：从倒计时开始持续显示暂停按钮。 */}
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
              <Button
                type="button"
                variant="ghost"
                onClick={pause}
                className="h-8 gap-1.5 rounded-md bg-[rgba(255,255,255,0.14)] px-3 text-xs text-[rgba(255,255,255,0.92)] hover:bg-[rgba(255,255,255,0.26)]"
              >
                <Pause size={13} />
                {tr("暂停", "Pause")}
              </Button>
            </div>
          </div>
        )}

        {/* 左下角：背景音乐推子（选歌时隐藏，保持选歌层干净） */}
        {phase !== "idle" && (
          <div className="absolute bottom-3 left-3 z-30">
            <div className="flex w-[min(48vw,260px)] items-center gap-3 rounded-full bg-[rgba(10,12,18,0.55)] px-4 py-2 backdrop-blur-[8px]">
              <span className="shrink-0 whitespace-nowrap text-[11px] text-[rgba(255,255,255,0.75)]">
                {tr("背景音乐", "Music")}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(song.mix.music * 100)}
                onChange={(e) => song.setSong({ mix: { ...song.mix, music: Number(e.target.value) / 100 } })}
                className="h-1.5 w-full min-w-0 cursor-pointer appearance-none rounded bg-[rgba(255,255,255,0.25)] accent-[var(--taiko-accent)]"
              />
            </div>
          </div>
        )}


        {/* 选歌层：未开始时覆盖在虚化的舞台上 */}
        {phase === "idle" && (
          <SongPicker
            speed={speed}
            onSpeedChange={onSpeedChange}
            onStart={start}
            onExit={onExit}
            onStartTutorial={() => setTutorialOpen(true)}
            exitLabel={exitLabel}
          />

        )}

        {phase === "idle" && tutorialOpen && (
          <TutorialOverlay
            gestureHits={gestureHits}
            onLeave={() => {
              markTutorialSeen();
              setTutorialOpen(false);
            }}
          />
        )}

        {settingsOpen && (
          <div
            className="absolute inset-0 z-[70] flex items-center justify-center bg-[var(--taiko-modal-scrim)] p-4 backdrop-blur-[18px]"
            role="dialog"
            aria-modal="true"
            aria-label={tr("全局设置", "Global settings")}
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setSettingsOpen(false);
            }}
          >
            <div className="taiko-scroll max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[var(--taiko-glass-line)] bg-[var(--taiko-glass-strong)] p-4 shadow-2xl backdrop-blur-[24px]">
              <div className="mb-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label={tr("关闭设置", "Close settings")}
                  className="grid h-9 w-9 place-items-center rounded-md border border-[var(--taiko-line)] text-[var(--taiko-ink)]/75 transition-colors hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
                >
                  <X size={16} />
                </button>
              </div>
              <GlobalSettings
                speed={speed}
                onSpeedChange={(next) => onSpeedChange?.(next)}
                onSecretUnlock={onSecretUnlock}
              />
            </div>
          </div>
        )}

        {phase === "paused" && (
          <Overlay>
            <p className="text-lg tracking-[0.3em] text-[var(--taiko-ink)]">{tr("已暂停", "PAUSED")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Button
                variant="outline"
                onClick={resume}
                className="h-12 w-32 border-[var(--taiko-glass-line)] bg-transparent px-5 text-sm text-[var(--taiko-ink)]/75 hover:border-[var(--taiko-glass-line-strong)] hover:text-[var(--taiko-ink)]"
              >
                {tr("继续", "Resume")}
              </Button>
              <Button
                variant="outline"
                onClick={start}
                className="h-12 w-32 border-[var(--taiko-glass-line)] bg-transparent px-5 text-sm text-[var(--taiko-ink)]/75 hover:border-[var(--taiko-glass-line-strong)] hover:text-[var(--taiko-ink)]"
              >
                {tr("重新开始", "Restart")}
              </Button>
              <Button
                variant="outline"
                onClick={backToPicker}
                className="h-12 w-32 border-[var(--taiko-glass-line)] bg-transparent px-5 text-sm text-[var(--taiko-ink)]/75 hover:border-[var(--taiko-glass-line-strong)] hover:text-[var(--taiko-ink)]"
              >
                {tr("退出", "Exit")}
              </Button>
            </div>
          </Overlay>
        )}
        {phase === "ended" && (
          <Overlay>
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">{tr("结算", "Result")}</p>

            <div className="flex items-center gap-4">
              <p className="text-5xl font-black text-[var(--taiko-accent)]">
                {ratingOfAccuracy(acc, {
                  progress: 100,
                  completed: true,
                  fullCombo: totalJudged > 0 && judged.miss === 0,
                })}
              </p>
              <p className="text-3xl font-bold tabular-nums text-white">
                {String(scoreRef.current).padStart(7, "0")}
              </p>
            </div>
            {resultRank && (resultRank.newBest || resultRank.rank) && (
              <p className="flex items-center gap-3 text-sm font-semibold">
                {resultRank.newBest && (
                  <span className="rounded-md bg-[var(--taiko-accent)] px-2 py-0.5 text-[var(--taiko-paper)]">
                    {tr("新纪录", "New record")}
                  </span>
                )}
                {resultRank.rank && (
                  <span className="text-white/85">
                    {tr("全球排名", "Global rank")} #{resultRank.rank}
                  </span>
                )}
              </p>
            )}
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
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[var(--taiko-modal-scrim)]">
      {children}
    </div>
  );
}

