/**
 * 全局参数（谱面屏顶部）：画质、视觉/判定偏移、自动校准、鼓音色、下落速度。
 * 一次设置对所有歌曲生效，不随歌曲变化。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { HelpDot } from "@/components/HelpDot";
import { HELP } from "./helpTexts";
import { TIER_LABEL, quality, type QualityMode, type QualityTier } from "./perf";
import {
  CALIB_RANGE,
  DEFAULT_CALIBRATION,
  loadCalibration,
  saveCalibration,
  tapOffsetMs,
  type Calibration,
} from "./calibration";
import { click as metronomeClick } from "./metronome";
import { loadKitEnabled, playDrum, saveKitEnabled, subscribeKitEnabled } from "./drumKit";
import { midiManager } from "./midiInput";
import { partOfNote } from "./laneLayouts";
import { songPlayer } from "./player";

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
const CALIB_TARGET = 8;

export function GlobalSettings({
  speed,
  onSpeedChange,
}: {
  speed: number;
  onSpeedChange: (s: number) => void;
}) {
  // ---- 画质 ----
  const [qualityMode, setQualityMode] = useState<QualityMode>("auto");
  const [tier, setTier] = useState<QualityTier>("high");
  useEffect(() => {
    quality.hydrate();
    setQualityMode(quality.getMode());
    setTier(quality.tier);
    return quality.subscribe(() => {
      setQualityMode(quality.getMode());
      setTier(quality.tier);
    });
  }, []);

  // ---- 偏移 ----
  const [calib, setCalib] = useState<Calibration>(DEFAULT_CALIBRATION);
  useEffect(() => {
    setCalib(loadCalibration());
  }, []);
  const updateCalib = (patch: Partial<Calibration>) =>
    setCalib((c) => saveCalibration({ ...c, ...patch }));

  // ---- 鼓音色 ----
  const [kitOn, setKitOn] = useState(true);
  const kitOnRef = useRef(true);
  useEffect(() => {
    const on = loadKitEnabled();
    setKitOn(on);
    kitOnRef.current = on;
    // 教学里的同一个开关切换时立刻同步
    return subscribeKitEnabled((next) => {
      kitOnRef.current = next;
      setKitOn(next);
    });
  }, []);
  const toggleKit = () => saveKitEnabled(!kitOnRef.current);


  // ---- 自动校准（节拍器一直响，敲满 8 下自动结算） ----
  const runRef = useRef<{ startMs: number; beatMs: number; taps: number[] } | null>(null);
  const timerRef = useRef<number | null>(null);
  const leadRef = useRef<number | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [taps, setTaps] = useState(0);

  const finish = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (leadRef.current !== null) window.clearTimeout(leadRef.current);
    leadRef.current = null;
    const run = runRef.current;
    runRef.current = null;
    setCalibrating(false);
    setTaps(0);
    if (!run || run.taps.length < 3) return;
    const off = tapOffsetMs(run.taps, run.startMs, run.beatMs);
    setCalib((c) => saveCalibration({ ...c, judgeMs: -off }));
  }, []);

  const startCalibration = useCallback(() => {
    if (runRef.current) return;
    songPlayer.pause();
    const beatMs = 500;
    const startMs = performance.now() + 600;
    runRef.current = { startMs, beatMs, taps: [] };
    setCalibrating(true);
    setTaps(0);
    let beat = 0;
    const tick = () => {
      const run = runRef.current;
      if (!run) return;
      if (run.taps.length >= CALIB_TARGET) {
        finish();
        return;
      }
      metronomeClick(beat % 4 === 0);
      beat++;
    };
    leadRef.current = window.setTimeout(() => {
      if (!runRef.current) return;
      tick();
      timerRef.current = window.setInterval(tick, beatMs);
    }, 600);
  }, [finish]);

  // 校准期间收集敲击时刻（同时出鼓声给反馈）
  useEffect(() => {
    void midiManager.init();
    const off = midiManager.onNote((note, vel, atMs) => {
      const run = runRef.current;
      const part = partOfNote(note);
      if (kitOnRef.current && part) playDrum(part, vel);
      if (!run) return;
      run.taps.push(atMs);
      setTaps(run.taps.length);
    });
    return off;
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      if (leadRef.current !== null) window.clearTimeout(leadRef.current);
    },
    [],
  );

  return (
    <section className="flex flex-col gap-3 border border-[var(--taiko-line)] bg-[var(--taiko-surface)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs tracking-[0.2em] text-[var(--taiko-accent)]">全局参数</span>
        <span className="text-[10px] text-[var(--taiko-ink)]/45">所有歌曲通用，只需设置一次</span>
      </div>

      {/* 画质 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1 text-xs text-[var(--taiko-ink)]/70">
          画质
          <HelpDot label="画质" text={HELP["quality"]!} />
        </span>
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

        <span className="mx-2 h-5 w-px bg-[var(--taiko-line)]" />
        <span className="mr-1 flex items-center gap-1 text-xs text-[var(--taiko-ink)]/70">
          下落速度
          <HelpDot label="下落速度" text={HELP["speed"]!} />
        </span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            className={`-ml-px border border-[var(--taiko-line)] px-3 py-1 text-xs tabular-nums transition-colors first:ml-0 ${
              speed === s
                ? "bg-[var(--taiko-ink)] text-[var(--taiko-paper)]"
                : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* 偏移 */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
        {(
          [
            ["visualMs", "音符视觉偏移"],
            ["judgeMs", "判定偏移"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-[11px] text-[var(--taiko-ink)]/70">
              <span className="flex items-center gap-1">
                {label}
                <HelpDot label={label} text={HELP[key]!} />
              </span>
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

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={calibrating ? finish : startCalibration}
          className="border border-[var(--taiko-line)] px-3 py-1.5 text-xs text-[var(--taiko-ink)]/80 transition-colors hover:border-[var(--taiko-ink)] hover:text-[var(--taiko-ink)]"
        >
          {calibrating ? `停止校准（${taps}/${CALIB_TARGET}）` : "自动校准"}
        </button>
        <HelpDot label="自动校准" text={HELP["calibrate"]!} />

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
        <HelpDot label="鼓音色" text={HELP["kit"]!} />
      </div>
    </section>
  );
}
