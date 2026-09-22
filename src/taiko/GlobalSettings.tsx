/**
 * 全局参数（谱面屏顶部）：画质、视觉/判定偏移、自动校准、鼓音色、下落速度。
 * 一次设置对所有歌曲生效，不随歌曲变化。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { HelpDot } from "@/components/HelpDot";
import { helpText } from "./helpTexts";
import { useLanguage } from "./i18n";
import { TIER_LABEL, TIER_LABEL_EN, quality, type QualityMode, type QualityTier } from "./perf";
import {
  CALIB_RANGE,
  DEFAULT_CALIBRATION,
  loadCalibration,
  saveCalibration,
  tapOffsetMs,
  type Calibration,
} from "./calibration";
import { click as metronomeClick } from "./metronome";
import {
  KIT_NAMES,
  ensureKitLoaded,
  loadKitEnabled,
  loadKitId,
  playDrum,
  saveKitEnabled,
  saveKitId,
  subscribeKitEnabled,
  subscribeKitId,
} from "./drumKit";
import { midiManager } from "./midiInput";
import { partOfNote } from "./laneLayouts";
import { songPlayer } from "./player";
import { useSong } from "./songStore";
import { DIFFICULTIES } from "./difficulty";

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
const CALIB_TARGET = 8;

export function GlobalSettings({
  speed,
  onSpeedChange,
}: {
  speed: number;
  onSpeedChange: (s: number) => void;
}) {
  const { tr, language } = useLanguage();
  const song = useSong();


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

  // ---- 鼓组选择 ----
  const [kitId, setKitId] = useState(0);
  useEffect(() => {
    const id = loadKitId();
    setKitId(id);
    if (loadKitEnabled()) void ensureKitLoaded(id);
    return subscribeKitId((next) => setKitId(next));
  }, []);
  const handleKitChange = (id: number) => saveKitId(id);

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
      if (kitOnRef.current && part) playDrum(part, vel, undefined, note);
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
    <section className="flex flex-col gap-3 rounded-md border border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-4 py-3 backdrop-blur-[18px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs tracking-[0.2em] text-[var(--taiko-accent)]">
          {tr("全局参数", "Global settings")}
        </span>
        <span className="text-[10px] text-[var(--taiko-ink)]/45">
          {tr("所有歌曲通用，只需设置一次", "Applies to every song, set once")}
        </span>
      </div>

      {/* 画质 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1 text-xs text-[var(--taiko-ink)]/70">
          {tr("画质", "Quality")}
          <HelpDot label={tr("画质", "Quality")} text={helpText("quality", language)} />
        </span>
        {(["auto", "high", "medium", "low"] as QualityMode[]).map((m) => (
          <button
            key={m}
            onClick={() => quality.setMode(m)}
            className={`-ml-px rounded-sm border border-[var(--taiko-line)] px-3 py-1 text-xs transition-colors first:ml-0 ${
              qualityMode === m
                ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent)] text-[var(--taiko-paper)]"
                : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
            }`}
          >
            {tr(TIER_LABEL[m], TIER_LABEL_EN[m])}
          </button>
        ))}
        <span className="text-[10px] text-[var(--taiko-ink)]/45">
          {(() => {
            const name = tr(TIER_LABEL[tier], TIER_LABEL_EN[tier]);
            return tr(
              `当前实际：${name}（卡顿时自动降档）`,
              `Actual: ${name} (auto steps down if it stutters)`,
            );
          })()}
        </span>

        <span className="mx-2 h-5 w-px bg-[var(--taiko-line)]" />
        <span className="mr-1 flex items-center gap-1 text-xs text-[var(--taiko-ink)]/70">
          {tr("下落速度", "Fall speed")}
          <HelpDot label={tr("下落速度", "Fall speed")} text={helpText("speed", language)} />
        </span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            className={`-ml-px rounded-sm border border-[var(--taiko-line)] px-3 py-1 text-xs tabular-nums transition-colors first:ml-0 ${
              speed === s
                ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent)] text-[var(--taiko-paper)]"
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
            ["visualMs", tr("音符视觉偏移", "Visual offset")],
            ["judgeMs", tr("判定偏移", "Judge offset")],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-[11px] text-[var(--taiko-ink)]/70">
              <span className="flex items-center gap-1">
                {label}
                <HelpDot label={label} text={helpText(key, language)} />
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

      {/* 难度（全局，紧跟偏移设置） */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1 text-xs text-[var(--taiko-ink)]/70">
          {tr("难度", "Difficulty")}
          <HelpDot label={tr("难度", "Difficulty")} text={helpText("difficulty", language)} />
        </span>
        {DIFFICULTIES.map((d) => (
          <button
            key={d.id}
            onClick={() => song.setSong({ difficulty: d.id })}
            className={`-ml-px rounded-sm border px-3 py-1 text-xs transition-colors first:ml-0 ${
              song.difficulty === d.id
                ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent)] text-[var(--taiko-paper)]"
                : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
            }`}
          >
            {tr(d.label, d.labelEn)}
          </button>
        ))}
      </div>


      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={calibrating ? finish : startCalibration}
          className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
            calibrating
              ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent)] text-[var(--taiko-paper)]"
              : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/80 hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
          }`}
        >
          {calibrating
            ? tr(`停止校准（${taps}/${CALIB_TARGET}）`, `Stop calibrating (${taps}/${CALIB_TARGET})`)
            : tr("自动校准", "Auto calibrate")}
        </button>
        <HelpDot label={tr("自动校准", "Auto calibrate")} text={helpText("calibrate", language)} />

        <span className="mx-1 h-5 w-px bg-[var(--taiko-line)]" />
        <button
          onClick={toggleKit}
          className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
            kitOn
              ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent)] text-[var(--taiko-paper)]"
              : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
          }`}
        >
          {tr("鼓音色", "Drum sound")} {kitOn ? tr("开", "On") : tr("关", "Off")}
        </button>
        <HelpDot label={tr("鼓音色", "Drum sound")} text={helpText("kit", language)} />

        <span className="mx-1 h-5 w-px bg-[var(--taiko-line)]" />
        <label className="flex items-center gap-2 text-xs text-[var(--taiko-ink)]/70">
          {tr("鼓组", "Drum kit")}
          <select
            value={kitId}
            onChange={(e) => handleKitChange(Number(e.target.value))}
            className="rounded-md border border-[var(--taiko-accent)] bg-[var(--taiko-surface)] px-2 py-1 text-xs text-[var(--taiko-ink)]"
          >
            {KIT_NAMES.map((k) => (
              <option
                key={k.id}
                value={k.id}
                className="bg-[var(--taiko-surface)] text-[var(--taiko-ink)]"
              >
                {tr(k.zh, k.en)}
              </option>
            ))}
          </select>
        </label>
        <HelpDot label={tr("鼓组", "Drum kit")} text={helpText("kitId", language)} />
      </div>
    </section>
  );
}
