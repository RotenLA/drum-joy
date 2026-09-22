import { useEffect, useMemo, useState } from "react";
import type { PartId } from "../laneLayouts";
import { PART_BY_ID } from "../laneLayouts";
import { useLanguage } from "../i18n";

import crash from "@/assets/pads/crash.png.asset.json";
import hihat from "@/assets/pads/hihat.png.asset.json";
import snare from "@/assets/pads/snare.png.asset.json";
import highTom from "@/assets/pads/hightom.png.asset.json";
import midTom from "@/assets/pads/midtom.png.asset.json";
import floorTom from "@/assets/pads/floortom.png.asset.json";
import ride from "@/assets/pads/ride.png.asset.json";
import pedalL from "@/assets/pads/pedalL_up.png.asset.json";
import pedalR from "@/assets/pads/pedalR_up.png.asset.json";

const SPRITES: Record<PartId, string> = { crash: crash.url, hihat: hihat.url, snare: snare.url, highTom: highTom.url, midTom: midTom.url, floorTom: floorTom.url, ride: ride.url, pedalHat: pedalL.url, kick: pedalR.url };
const POS: Record<PartId, { left: string; top: string; width: string }> = {
  crash: { left: "12%", top: "21%", width: "22%" }, highTom: { left: "35%", top: "27%", width: "16%" }, midTom: { left: "50%", top: "27%", width: "16%" }, ride: { left: "67%", top: "21%", width: "22%" }, hihat: { left: "21%", top: "50%", width: "19%" }, snare: { left: "41%", top: "53%", width: "19%" }, floorTom: { left: "63%", top: "48%", width: "20%" }, pedalHat: { left: "38%", top: "78%", width: "8%" }, kick: { left: "55%", top: "78%", width: "8%" },
};

export function TutorialStage({ targets = [], hitPart, progress, needed, hold }: { targets?: readonly PartId[]; hitPart: PartId | null; progress: number; needed: number; hold: boolean }) {
  const { language } = useLanguage();
  const [pulse, setPulse] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setPulse((v) => v + 1), 900); return () => window.clearInterval(timer); }, []);
  const active = useMemo(() => targets.length ? targets[pulse % targets.length] : null, [targets, pulse]);
  return <div className="relative h-full min-h-[260px] overflow-hidden bg-[rgba(8,7,9,0.54)]">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(252,136,0,0.14),rgba(8,7,9,0.08)_44%,rgba(8,7,9,0.72)_100%)]" />
    {Object.keys(POS).map((key) => { const id = key as PartId; const highlighted = hitPart === id || active === id; return <div key={id} className="absolute transition-all duration-150" style={{ ...POS[id], transform: highlighted ? "scale(1.08)" : "scale(1)", filter: highlighted ? "brightness(1.45) drop-shadow(0 0 12px rgba(252,136,0,.9))" : "brightness(.72)", opacity: targets.length && !targets.includes(id) ? .42 : .94 }}><img src={SPRITES[id]} alt={language === "zh-CN" ? PART_BY_ID[id].label : PART_BY_ID[id].labelEn} className="block h-auto w-full" /></div>; })}
    {targets.length > 0 && <div key={`${pulse}-${active}`} className="taiko-tutorial-note absolute left-1/2 top-[8%] h-7 w-7 rounded-full border-2 border-[var(--taiko-accent)] bg-[rgba(252,136,0,0.72)] shadow-[0_0_18px_rgba(252,136,0,0.85)]" />}
    <div className="absolute bottom-3 left-3 rounded-md border border-[var(--taiko-glass-line)] bg-[rgba(8,7,9,0.72)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.84)]">{hold ? (language === "zh-CN" ? "保持踩住" : "Keep holding") : `${progress} / ${needed}`}</div>
  </div>;
}