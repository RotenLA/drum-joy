import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { midiManager } from "../midiInput";
import { partOfNote, type PartId } from "../laneLayouts";
import { gestureHitDetector, noteOfPart } from "../gestureHit";
import { loadKitEnabled, playDrum, saveKitEnabled, subscribeKitEnabled } from "../drumKit";
import { useLanguage } from "../i18n";
import { TutorialStage } from "./TutorialStage";
import { TUTORIAL_STEPS, tutorialLabels, tutorialStepCopy } from "./steps";
import { VISIBLE_PARTS } from "../laneLayouts";
import { stickManager } from "../stickInput";
import type { TaikoChart } from "@/shared/taikoChart";

export const TUTORIAL_SEEN_KEY = "taiko.tutorial.v3";
export const markTutorialSeen = () => { try { localStorage.setItem(TUTORIAL_SEEN_KEY, "1"); } catch { /* memory-only environment */ } };

export function TutorialOverlay({ onLeave, gestureHits = false }: { onLeave: () => void; gestureHits?: boolean }) {
  const { language } = useLanguage();
  const labels = tutorialLabels(language);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [passed, setPassed] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  /** 手机音色开关（与全局设置同一份，双向同步） */
  const [kitOn, setKitOn] = useState(true);
  useEffect(() => {
    setKitOn(loadKitEnabled());
    return subscribeKitEnabled((on) => setKitOn(on));
  }, []);
  /** 命中闪光：partId -> 到期时间戳（performance.now 基准），交给正式渲染器 */
  const flashes = useRef<Record<string, number>>({});
  const step = TUTORIAL_STEPS[index] ?? TUTORIAL_STEPS[0];
  /** 练习时钟：由舞台写入，用来判断敲击是否对上了正确音符 */
  const clockRef = useRef<{ timeMs: number; chart: TaikoChart | null }>({ timeMs: 0, chart: null });
  /** 已被命中的音符（按 时间:音高 键），避免一个音符重复计数 */
  const consumedRef = useRef<Set<string>>(new Set());
  /** 认识鼓件：已敲过的部件 */
  const [touched, setTouched] = useState<ReadonlySet<PartId>>(new Set());
  const needed = step.needed ?? 1;

  useEffect(() => { stickManager.resetLayers(); }, []);

  const reset = useCallback(() => { consumedRef.current = new Set(); setTouched(new Set()); setProgress(0); setHeld(false); setPassed(false); flashes.current = {}; setRestartKey((v) => v + 1); }, []);
  const advance = useCallback(() => { if (index >= TUTORIAL_STEPS.length - 1) { markTutorialSeen(); onLeave(); return; } setIndex((v) => v + 1); reset(); }, [index, onLeave, reset]);
  const goBack = useCallback(() => { if (index <= 0) return; setIndex((v) => v - 1); reset(); }, [index, reset]);

  useEffect(() => { void midiManager.init(); }, []);

  /** 一次击打（MIDI 或角度判定共用）：出声、闪光、推进步骤进度 */
  const onHit = useCallback((part: PartId, velocity: number, atMs?: number, note?: number) => {
    stickManager.switchLayerForHit(part, VISIBLE_PARTS.nine);
    flashes.current[part] = performance.now() + 200;
    if (loadKitEnabled()) playDrum(part, velocity, undefined, note, atMs);

    if (passed) return;
    if (step.kind === "parts") {
      setTouched((prev) => {
        if (prev.has(part)) return prev;
        const next = new Set(prev); next.add(part);
        if (VISIBLE_PARTS.nine.every((p) => next.has(p))) setPassed(true);
        return next;
      });
      return;
    }
    if (step.kind === "hold" && part === "pedalHat") { setHeld(true); return; }
    if (!step.targets?.includes(part)) return;
    // 真实判定：必须在对应鼓件音符附近敲到才计数（敲错鼓件或空敲不算）
    const { timeMs, chart } = clockRef.current;
    if (!chart) return;
    const WINDOW = 200;
    const dur = chart.durationMs || 0;
    const keyOf = (n: { timeMs: number; note?: number }) => `${n.timeMs}:${n.note ?? ""}`;
    const hit = chart.notes.find((n) => {
      if (n.note === undefined || partOfNote(n.note) !== part || consumedRef.current.has(keyOf(n))) return false;
      let d = Math.abs(n.timeMs - timeMs);
      if (dur > 0) d = Math.min(d, dur - d);
      return d <= WINDOW;
    });
    if (!hit) return;
    consumedRef.current.add(keyOf(hit));
    // 同一时刻的配对音符（如闭镲 + 左踏板同时触发课）：两个都命中才计 1 次
    const partner = chart.notes.find(
      (n) =>
        n !== hit &&
        n.timeMs === hit.timeMs &&
        n.note !== undefined &&
        partOfNote(n.note) !== part &&
        step.targets?.includes(partOfNote(n.note) as PartId),
    );
    if (partner && !consumedRef.current.has(keyOf(partner))) return;
    setProgress((value) => { const next = value + 1; if (next >= needed) setPassed(true); return Math.min(next, needed); });
  }, [needed, passed, step.kind, step.targets]);

  // 击打入口放进 ref：订阅只挂一次，步骤推进导致的重渲染不会重启角度判定器
  const onHitRef = useRef(onHit);
  onHitRef.current = onHit;

  useEffect(() => {
    const off = midiManager.onNote((note, velocity, atMs) => {
      const part = partOfNote(note);
      if (!part) return;
      // 律动大师模式：手部鼓面只认角度判定，MIDI 只负责两个踏板
      if (gestureHits && part !== "pedalHat" && part !== "kick") return;
      onHitRef.current(part, velocity, atMs, note);
    });
    const offUp = midiManager.onNoteOff((note) => { if (step.kind === "hold" && partOfNote(note) === "pedalHat") { setHeld(false); if (!passed) setProgress(0); } });
    return () => { off(); offUp(); };
  }, [gestureHits, passed, step.kind]);

  // 律动大师模式：手部击打由鼓棒角度轨迹判定，与进歌演奏完全一致
  useEffect(() => {
    if (!gestureHits) return;
    return gestureHitDetector.start((hit) => {
      onHitRef.current(hit.part, hit.velocity, hit.atMs, noteOfPart(hit.part));
    }, { parts: VISIBLE_PARTS.nine });
  }, [gestureHits]);


  // 100 BPM × 8 拍 = 4.8 秒；中途抬起会取消并归零。
  useEffect(() => {
    if (step.kind !== "hold" || !held || passed) return;
    const timer = window.setTimeout(() => { setProgress(1); setPassed(true); setHeld(false); }, 4800);
    return () => window.clearTimeout(timer);
  }, [held, passed, step.kind]);

  // 完成后短暂显示「完成」再自动进入下一课
  useEffect(() => {
    if (!passed || step.kind === "done") return;
    const timer = window.setTimeout(advance, 1400);
    return () => window.clearTimeout(timer);
  }, [passed, step.kind, advance]);

  const canNext = useMemo(() => step.kind === "parts" || step.kind === "done" || passed, [passed, step.kind]);
  const copy = tutorialStepCopy(language, index, step);

  return <div className="taiko-tutorial-layout absolute inset-0 z-50 flex min-h-0 bg-[var(--taiko-paper)]">
    <section className="relative min-h-0 min-w-0 flex-[2.1]"><TutorialStage step={step} index={index} flashes={flashes} progress={progress} needed={needed} hold={held} restartKey={restartKey} clockRef={clockRef} />{passed && <div className="absolute inset-0 flex items-center justify-center bg-[rgba(8,7,9,0.34)]"><div className="rounded-lg border border-[var(--taiko-accent)] bg-[var(--taiko-glass-strong)] px-8 py-5 text-center text-xl text-[var(--taiko-accent)]">{labels.complete}</div></div>}</section>
    <aside className="taiko-scroll relative min-h-0 min-w-[260px] flex-1 overflow-y-auto border-l border-[var(--taiko-glass-line)] bg-[var(--taiko-glass-strong)] px-5 pb-5 pt-16 backdrop-blur-[18px]">
      <div className="absolute right-3 top-3 flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={() => setKitOn(saveKitEnabled(!kitOn))} className={kitOn
          ? "h-9 min-w-32 border-[var(--taiko-accent)] bg-[var(--taiko-glass)] px-4 text-sm text-[var(--taiko-accent)]"
          : "h-9 min-w-32 border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-4 text-sm text-[rgba(255,255,255,0.6)]"}>
          {kitOn ? <Volume2 size={15} /> : <VolumeX size={15} />}{kitOn ? (labels.kitOn ?? "Mobile sound on") : (labels.kitOff ?? "Mobile sound off")}
        </Button>
        <Button variant="outline" onClick={() => { markTutorialSeen(); onLeave(); }} className="h-9 min-w-24 border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-4 text-sm text-[var(--taiko-ink)] hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"><X size={15} />{labels.leave}</Button>
      </div>
      <p className="text-xs tabular-nums text-[var(--taiko-accent)]">{labels.tutorial} {index + 1} / {TUTORIAL_STEPS.length}</p>
      <h2 className="mt-2 text-2xl font-semibold text-[var(--taiko-ink)]">{copy.title}</h2>
      <p className="mt-3 text-sm leading-7 text-[rgba(255,255,255,0.72)]">{copy.body}</p>
      {step.targets && <p className="mt-5 text-sm text-[rgba(255,255,255,0.62)]">{labels.progress}: {progress} / {needed}</p>}
      {step.kind === "parts" && <p className="mt-5 text-sm text-[rgba(255,255,255,0.62)]">{labels.progress}: {touched.size} / {VISIBLE_PARTS.nine.length}</p>}
      <div className="mt-7 flex flex-wrap gap-2">
        {index > 0 && <Button variant="outline" onClick={goBack} className="h-9 min-w-24 border-[var(--taiko-glass-line)] bg-transparent px-4 text-sm text-[var(--taiko-ink)]">{language.startsWith("zh") ? (language === "zh-TW" ? "上一步" : "上一步") : "Back"}</Button>}
        <Button onClick={advance} disabled={!canNext} className="h-9 min-w-24 bg-[var(--taiko-accent)] px-4 text-sm text-[var(--taiko-paper)] hover:bg-[var(--taiko-accent-2)]">{step.kind === "done" ? labels.finish : labels.next}</Button>
        {step.targets && <Button variant="outline" onClick={reset} className="h-9 min-w-24 border-[var(--taiko-glass-line)] bg-transparent px-4 text-sm text-[var(--taiko-ink)]">{labels.retry}</Button>}
        {step.targets && !passed && <Button variant="ghost" onClick={advance} className="h-9 min-w-24 px-4 text-sm text-[rgba(255,255,255,0.58)]">{labels.skip}</Button>}
      </div>
    </aside>
  </div>;
}