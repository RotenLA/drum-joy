import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { midiManager } from "../midiInput";
import { deviceState } from "../deviceState";
import { partOfNote, type PartId } from "../laneLayouts";
import { loadKitEnabled, playDrum } from "../drumKit";
import { useLanguage } from "../i18n";
import { TutorialStage } from "./TutorialStage";
import { TUTORIAL_STEPS, tutorialLabels } from "./steps";

export const TUTORIAL_SEEN_KEY = "taiko.tutorial.v3";
export const tutorialSeen = () => { try { return localStorage.getItem(TUTORIAL_SEEN_KEY) === "1"; } catch { return false; } };
export const markTutorialSeen = () => { try { localStorage.setItem(TUTORIAL_SEEN_KEY, "1"); } catch { /* memory-only environment */ } };

export function TutorialOverlay({ onLeave }: { onLeave: () => void }) {
  const { language } = useLanguage();
  const labels = tutorialLabels(language);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [hitPart, setHitPart] = useState<PartId | null>(null);
  const [stickSeen, setStickSeen] = useState(false);
  const [pedalSeen, setPedalSeen] = useState(false);
  const [held, setHeld] = useState(false);
  const [passed, setPassed] = useState(false);
  const [devices, setDevices] = useState(deviceState.state);
  const step = TUTORIAL_STEPS[index] ?? TUTORIAL_STEPS[0];
  const needed = step.needed ?? 1;

  const reset = useCallback(() => { setProgress(0); setHeld(false); setPassed(false); setHitPart(null); }, []);
  const advance = useCallback(() => { if (index >= TUTORIAL_STEPS.length - 1) { markTutorialSeen(); onLeave(); return; } setIndex((v) => v + 1); reset(); }, [index, onLeave, reset]);

  useEffect(() => { void midiManager.init(); deviceState.query(); return deviceState.subscribe(setDevices); }, []);
  useEffect(() => {
    const off = midiManager.onNote((note, velocity) => {
      const part = partOfNote(note);
      if (!part) return;
      setHitPart(part); window.setTimeout(() => setHitPart((old) => old === part ? null : old), 180);
      if (loadKitEnabled()) playDrum(part, velocity, undefined, note);
      if (note === 36 || note === 44) setPedalSeen(true); else setStickSeen(true);
      if (step.kind === "hold" && part === "pedalHat") { setHeld(true); return; }
      if (!step.targets?.includes(part) || passed) return;
      setProgress((value) => { const next = value + 1; if (next >= needed) setPassed(true); return Math.min(next, needed); });
    });
    const offUp = midiManager.onNoteOff((note) => { if (step.kind === "hold" && partOfNote(note) === "pedalHat" && held) { setHeld(false); setProgress(1); setPassed(true); } });
    return () => { off(); offUp(); };
  }, [held, needed, passed, step.kind, step.targets]);

  const adapterReady = devices.m || midiManager.inputs().some((d) => /pd2u|pd2max|pd2|max/i.test(d.name));
  const canNext = useMemo(() => step.kind === "device" ? (index === 0 ? adapterReady : stickSeen && pedalSeen) : step.kind === "parts" || step.kind === "done" || passed, [adapterReady, index, passed, pedalSeen, step.kind, stickSeen]);
  const title = language === "zh-CN" || language === "zh-TW" ? step.titleZh : step.titleEn;
  const body = language === "zh-CN" || language === "zh-TW" ? step.bodyZh : step.bodyEn;

  return <div className="absolute inset-0 z-50 flex min-h-0 bg-[var(--taiko-paper)]">
    <section className="min-h-0 min-w-0 flex-[2.1]"><TutorialStage targets={step.targets} hitPart={hitPart} progress={progress} needed={needed} hold={held} />{passed && <div className="absolute inset-y-0 left-0 flex w-[68%] items-center justify-center bg-[rgba(8,7,9,0.34)]"><div className="rounded-lg border border-[var(--taiko-accent)] bg-[var(--taiko-glass-strong)] px-8 py-5 text-center text-xl text-[var(--taiko-accent)]">{language === "zh-CN" ? "完成！" : "Complete!"}</div></div>}</section>
    <aside className="taiko-scroll relative min-h-0 min-w-[260px] flex-1 overflow-y-auto border-l border-[var(--taiko-glass-line)] bg-[var(--taiko-glass-strong)] px-5 pb-5 pt-16 backdrop-blur-[18px]">
      <Button variant="outline" size="sm" onClick={() => { markTutorialSeen(); onLeave(); }} className="absolute right-3 top-3 border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] text-[var(--taiko-ink)] hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"><X size={15} />{labels.leave}</Button>
      <p className="text-xs tabular-nums text-[var(--taiko-accent)]">{labels.tutorial} {index + 1} / {TUTORIAL_STEPS.length}</p>
      <h2 className="mt-2 text-2xl font-semibold text-[var(--taiko-ink)]">{title}</h2>
      <p className="mt-3 text-sm leading-7 text-[rgba(255,255,255,0.72)]">{body}</p>
      {step.kind === "device" && <div className="mt-5 space-y-2 text-sm"><Status ok={index === 0 ? adapterReady : stickSeen} text={index === 0 ? "PD2U / PD2MAX" : (language === "zh-CN" ? "鼓槌输入" : "Stick input")} /><Status ok={index === 0 ? adapterReady : pedalSeen} text={index === 0 ? (language === "zh-CN" ? "适配器" : "Adapter") : (language === "zh-CN" ? "踏板输入" : "Pedal input")} /></div>}
      {step.targets && <p className="mt-5 text-sm text-[rgba(255,255,255,0.62)]">{language === "zh-CN" ? "练习进度" : "Progress"}: {progress} / {needed}</p>}
      <div className="mt-7 flex flex-wrap gap-2">
        <Button onClick={advance} disabled={!canNext} className="bg-[var(--taiko-accent)] text-[var(--taiko-paper)] hover:bg-[var(--taiko-accent-2)]">{step.kind === "done" ? labels.finish : labels.next}</Button>
        {step.targets && <Button variant="outline" onClick={reset} className="border-[var(--taiko-glass-line)] bg-transparent text-[var(--taiko-ink)]">{labels.retry}</Button>}
        {step.targets && !passed && <Button variant="ghost" onClick={advance} className="text-[rgba(255,255,255,0.58)]">{labels.skip}</Button>}
      </div>
    </aside>
  </div>;
}

function Status({ ok, text }: { ok: boolean; text: string }) { return <div className={`rounded-md border px-3 py-2 ${ok ? "border-[var(--taiko-accent)] text-[var(--taiko-accent)]" : "border-[var(--taiko-glass-line)] text-[rgba(255,255,255,0.5)]"}`}>{ok ? "●" : "○"} {text}</div>; }