import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { midiManager } from "../midiInput";
import { partOfNote } from "../laneLayouts";
import { loadKitEnabled, playDrum, saveKitEnabled, subscribeKitEnabled } from "../drumKit";
import { useLanguage } from "../i18n";
import { TutorialStage } from "./TutorialStage";
import { TUTORIAL_STEPS, tutorialLabels, tutorialStepCopy } from "./steps";

export const TUTORIAL_SEEN_KEY = "taiko.tutorial.v3";
export const markTutorialSeen = () => { try { localStorage.setItem(TUTORIAL_SEEN_KEY, "1"); } catch { /* memory-only environment */ } };

export function TutorialOverlay({ onLeave }: { onLeave: () => void }) {
  const { language } = useLanguage();
  const labels = tutorialLabels(language);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [passed, setPassed] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  /** 鼓音色开关（与全局设置同一份，双向同步） */
  const [kitOn, setKitOn] = useState(true);
  useEffect(() => {
    setKitOn(loadKitEnabled());
    return subscribeKitEnabled((on) => setKitOn(on));
  }, []);
  /** 命中闪光：partId -> 到期时间戳（performance.now 基准），交给正式渲染器 */
  const flashes = useRef<Record<string, number>>({});
  const step = TUTORIAL_STEPS[index] ?? TUTORIAL_STEPS[0];
  const needed = step.needed ?? 1;

  const reset = useCallback(() => { setProgress(0); setHeld(false); setPassed(false); flashes.current = {}; setRestartKey((v) => v + 1); }, []);
  const advance = useCallback(() => { if (index >= TUTORIAL_STEPS.length - 1) { markTutorialSeen(); onLeave(); return; } setIndex((v) => v + 1); reset(); }, [index, onLeave, reset]);

  useEffect(() => { void midiManager.init(); }, []);
  useEffect(() => {
    const off = midiManager.onNote((note, velocity) => {
      const part = partOfNote(note);
      if (!part) return;
      flashes.current[part] = performance.now() + 200;
      if (loadKitEnabled()) playDrum(part, velocity, undefined, note);
      if (step.kind === "hold" && part === "pedalHat") { setHeld(true); return; }
      if (!step.targets?.includes(part) || passed) return;
      setProgress((value) => { const next = value + 1; if (next >= needed) setPassed(true); return Math.min(next, needed); });
    });
    const offUp = midiManager.onNoteOff((note) => { if (step.kind === "hold" && partOfNote(note) === "pedalHat") { setHeld(false); if (!passed) setProgress(0); } });
    return () => { off(); offUp(); };
  }, [held, needed, passed, step.kind, step.targets]);

  // 100 BPM × 8 拍 = 4.8 秒；中途抬起会取消并归零。
  useEffect(() => {
    if (step.kind !== "hold" || !held || passed) return;
    const timer = window.setTimeout(() => { setProgress(1); setPassed(true); setHeld(false); }, 4800);
    return () => window.clearTimeout(timer);
  }, [held, passed, step.kind]);

  const canNext = useMemo(() => step.kind === "parts" || step.kind === "done" || passed, [passed, step.kind]);
  const copy = tutorialStepCopy(language, index, step);

  return <div className="taiko-tutorial-layout absolute inset-0 z-50 flex min-h-0 bg-[var(--taiko-paper)]">
    <section className="relative min-h-0 min-w-0 flex-[2.1]"><TutorialStage step={step} index={index} flashes={flashes} progress={progress} needed={needed} hold={held} restartKey={restartKey} />{passed && <div className="absolute inset-0 flex items-center justify-center bg-[rgba(8,7,9,0.34)]"><div className="rounded-lg border border-[var(--taiko-accent)] bg-[var(--taiko-glass-strong)] px-8 py-5 text-center text-xl text-[var(--taiko-accent)]">{labels.complete}</div></div>}</section>
    <aside className="taiko-scroll relative min-h-0 min-w-[260px] flex-1 overflow-y-auto border-l border-[var(--taiko-glass-line)] bg-[var(--taiko-glass-strong)] px-5 pb-5 pt-16 backdrop-blur-[18px]">
      <Button variant="outline" size="sm" onClick={() => { markTutorialSeen(); onLeave(); }} className="absolute right-3 top-3 border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] text-[var(--taiko-ink)] hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"><X size={15} />{labels.leave}</Button>
      <p className="text-xs tabular-nums text-[var(--taiko-accent)]">{labels.tutorial} {index + 1} / {TUTORIAL_STEPS.length}</p>
      <h2 className="mt-2 text-2xl font-semibold text-[var(--taiko-ink)]">{copy.title}</h2>
      <p className="mt-3 text-sm leading-7 text-[rgba(255,255,255,0.72)]">{copy.body}</p>
      {step.targets && <p className="mt-5 text-sm text-[rgba(255,255,255,0.62)]">{labels.progress}: {progress} / {needed}</p>}
      <div className="mt-7 flex flex-wrap gap-2">
        <Button onClick={advance} disabled={!canNext} className="bg-[var(--taiko-accent)] text-[var(--taiko-paper)] hover:bg-[var(--taiko-accent-2)]">{step.kind === "done" ? labels.finish : labels.next}</Button>
        {step.targets && <Button variant="outline" onClick={reset} className="border-[var(--taiko-glass-line)] bg-transparent text-[var(--taiko-ink)]">{labels.retry}</Button>}
        {step.targets && !passed && <Button variant="ghost" onClick={advance} className="text-[rgba(255,255,255,0.58)]">{labels.skip}</Button>}
      </div>
    </aside>
  </div>;
}