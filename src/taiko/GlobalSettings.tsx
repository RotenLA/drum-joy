/**
 * 全局参数：下落速度、画质、视觉/判定偏移、自动校准。
 * 一次设置对所有歌曲生效，不随歌曲变化。
 * 难度、手机音色、鼓组在展开的歌曲卡片里设置，此处不重复。
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
import { loadKitEnabled, playDrum, subscribeKitEnabled } from "./drumKit";
import { midiManager } from "./midiInput";
import { partOfNote } from "./laneLayouts";
import { songPlayer } from "./player";
import { Button } from "@/components/ui/button";

const CALIB_TARGET = 8;
const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

export function GlobalSettings({
  speed,
  onSpeedChange,
  onSecretUnlock,
}: {
  speed: number;
  onSpeedChange: (speed: number) => void;
  onSecretUnlock?: (() => void) | undefined;
}) {
  const { tr, language } = useLanguage();
  const labTapRef = useRef({ count: 0, at: 0 });

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

  // ---- 校准期间是否出鼓声（跟随手机音色开关，开关本身在歌曲卡片里） ----
  const kitOnRef = useRef(true);
  useEffect(() => {
    kitOnRef.current = loadKitEnabled();
    return subscribeKitEnabled((next) => {
      kitOnRef.current = next;
    });
  }, []);

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
      if (!run || run.taps.length >= CALIB_TARGET) return;
      const last = run.taps[run.taps.length - 1];
      if (last !== undefined && atMs - last < 120) return;
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

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-[var(--taiko-ink)]/70">
          {tr("下落速度", "Fall speed")}
        </span>
        {SPEEDS.map((value) => (
          <Button
            key={value}
            variant="outline"
            size="sm"
            type="button"
            onClick={() => {
              onSpeedChange(value);
              const tap = labTapRef.current;
              if (value !== 1.5 || !onSecretUnlock) {
                tap.count = 0;
                tap.at = 0;
                return;
              }
              const now = Date.now();
              tap.count = now - tap.at > 4000 ? 1 : tap.count + 1;
              tap.at = now;
              if (tap.count < 12) return;
              tap.count = 0;
              onSecretUnlock();
            }}
            className={`h-8 min-w-14 rounded-md px-3 text-xs tabular-nums ${
              speed === value
                ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent)] text-[var(--taiko-paper)]"
                : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/70 hover:border-[var(--taiko-accent)]"
            }`}
          >
            {value}x
          </Button>
        ))}
      </div>

      {/* 画质 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1 text-xs text-[var(--taiko-ink)]/70">
          {tr("画质", "Quality")}
          <HelpDot label={tr("画质", "Quality")} text={helpText("quality", language)} />
        </span>
        {(["auto", "high", "medium", "low"] as QualityMode[]).map((m) => (
          <Button
            key={m}
            variant="outline"
            size="sm"
            onClick={() => quality.setMode(m)}
            className={`h-8 min-w-16 rounded-md border-[var(--taiko-line)] px-3 text-xs ${
              qualityMode === m
                ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent)] text-[var(--taiko-paper)]"
                : "text-[var(--taiko-ink)]/60 hover:text-[var(--taiko-ink)]"
            }`}
          >
            {tr(TIER_LABEL[m], TIER_LABEL_EN[m])}
          </Button>
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

      {/* 自动校准 */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={calibrating ? finish : startCalibration}
          className={`h-8 min-w-28 rounded-md px-3 text-xs ${
            calibrating
              ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent)] text-[var(--taiko-paper)]"
              : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/80 hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
          }`}
        >
          {calibrating
            ? tr(`停止校准（${taps}/${CALIB_TARGET}）`, `Stop calibrating (${taps}/${CALIB_TARGET})`)
            : tr("自动校准", "Auto calibrate")}
        </Button>
        <HelpDot label={tr("自动校准", "Auto calibrate")} text={helpText("calibrate", language)} />
      </div>
    </section>
  );
}
