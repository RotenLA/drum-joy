/**
 * 实验室·特雷门：左踏板(44)踩住发声、松开关闭；右踏板(36)点按切换正弦/三角波（忽略抬脚）；
 * 右手左右=音高、上下=音量；左手上下=颤音深度、左右=颤音快慢。
 */
import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { useLanguage } from "../i18n";
import { midiManager } from "../midiInput";
import { stickManager } from "../stickInput";
import { ThereminEngine, noteName } from "./ThereminEngine";

const KICK = 36;
const HAT = 44;
const norm = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

export function ThereminScreen({ onExit }: { onExit: () => void }) {
  const { tr } = useLanguage();
  const engine = useRef(new ThereminEngine());
  const [gate, setGate] = useState(false);
  const [tri, setTri] = useState(false);
  const [view, setView] = useState({ x: 0.5, vol: 0.5, hz: 392, vib: 0, has: false });
  const smooth = useRef({ x: 0.5, vol: 0.5 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const triRef = useRef(false);

  useEffect(() => {
    const e = engine.current;
    e.start();
    const offOn = midiManager.onNote((note) => {
      if (note === HAT) { e.setGate(true); setGate(true); }
      else if (note === KICK) {
        const next = !triRef.current;
        triRef.current = next;
        e.setTriangle(next);
        setTri(next);
      }
    });
    const offOff = midiManager.onNoteOff((note) => {
      if (note === HAT) { e.setGate(false); setGate(false); }
      // 右踏板抬脚忽略：波形由踩下时点按切换
    });
    let lastUi = 0;
    const offFrame = stickManager.onFrame((snap) => {
      const sm = smooth.current;
      let hz = 0;
      if (snap.r) {
        sm.x += (norm(snap.r.y, -60, 60) - sm.x) * 0.5;
        sm.vol += (norm(snap.r.p, -20, 50) - sm.vol) * 0.5;
        hz = e.setPitch(sm.x);
        e.setVolume(0.15 + sm.vol * 0.85);
      }
      let vib = 0;
      if (snap.l) {
        vib = norm(snap.l.p, -10, 50);
        e.setVibrato(vib, norm(snap.l.y, -60, 60));
      }
      if (snap.at - lastUi > 50) {
        lastUi = snap.at;
        setView((v) => ({ x: sm.x, vol: sm.vol, hz: hz || v.hz, vib, has: !!snap.r }));
      }
    });
    const unlock = () => e.resume();
    window.addEventListener("pointerdown", unlock);
    return () => { offOn(); offOff(); offFrame(); window.removeEventListener("pointerdown", unlock); e.stop(); };
  }, []);

  // 波形示意：正弦/三角按淡化进度混合
  useEffect(() => {
    let raf = 0;
    let mix = 0;
    const draw = () => {
      const c = canvas.current;
      if (c) {
        const g = c.getContext("2d")!;
        const w = c.width, h = c.height;
        mix += ((triRef.current ? 1 : 0) - mix) * 0.12;
        g.clearRect(0, 0, w, h);
        g.strokeStyle = "rgba(255,170,90,0.9)";
        g.lineWidth = 3;
        g.beginPath();
        for (let i = 0; i <= w; i += 2) {
          const ph = (i / w) * 4 * Math.PI * 2;
          const s = Math.sin(ph);
          const t = (2 / Math.PI) * Math.asin(s);
          const y = h / 2 - (s * (1 - mix) + t * mix) * h * 0.38;
          if (i === 0) g.moveTo(i, y); else g.lineTo(i, y);
        }
        g.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[var(--taiko-paper)] text-[var(--taiko-ink)]">
      <div className="flex items-start justify-between p-4">
        <div className="max-w-[60%] space-y-1 text-xs leading-5 text-[rgba(255,255,255,0.7)]">
          <div>{tr("左踏板踩住：发声；松开：关闭", "Left pedal hold: sound on; release: off")}</div>
          <div>{tr("右踏板点按：切换 正弦 ↔ 三角", "Right pedal tap: toggle sine ↔ triangle")}</div>
          <div>{tr("右手左右：音高；上下：音量", "Right stick sweep: pitch; raise: volume")}</div>
          <div>{tr("左手上下：颤音深度；左右：颤音快慢", "Left stick raise: vibrato depth; sweep: vibrato rate")}</div>
        </div>
        <button type="button" onClick={onExit} className="flex items-center gap-1.5 rounded-md border border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-3 py-2 text-sm hover:text-[var(--taiko-accent)]">
          <LogOut size={15} />{tr("返回", "Back")}
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="text-6xl font-semibold tabular-nums" style={{ opacity: gate ? 1 : 0.35 }}>{noteName(view.hz)}</div>
        <div className="text-sm text-[rgba(255,255,255,0.6)]">{Math.round(view.hz)} Hz · {tri ? tr("三角波", "Triangle") : tr("正弦波", "Sine")}</div>
        <div className="relative h-3 w-[min(80vw,720px)] rounded-full bg-[var(--taiko-glass)]">
          {Array.from({ length: 25 }, (_, i) => (
            <div key={i} className="absolute top-0 h-3 w-px bg-[rgba(255,255,255,0.25)]" style={{ left: `${(i / 24) * 100}%` }} />
          ))}
          <div className="absolute -top-2 h-7 w-3 -translate-x-1/2 rounded-full bg-[var(--taiko-accent)] transition-[left] duration-75" style={{ left: `${view.x * 100}%`, opacity: view.has ? 1 : 0.3 }} />
        </div>
        <canvas ref={canvas} width={720} height={140} className="w-[min(80vw,720px)]" style={{ opacity: gate ? 1 : 0.35 }} />
        <div className="flex gap-6 text-xs text-[rgba(255,255,255,0.6)]">
          <span>{tr("音量", "Volume")} {Math.round(view.vol * 100)}%</span>
          <span>{tr("颤音", "Vibrato")} {Math.round(view.vib * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
