/**
 * 实验室「横排缩圈」渲染器（仅实验室使用，正式版不引用）。
 *
 * 第一排：当前难度可用的手部鼓面一字平铺，音符垂直匀速下落到判定线。
 * 第二排：两个踏板（左=踩镲踏板，右=底鼓）固定不动，音符以外圈收缩提示，
 * 外圈与踏板圆重合的瞬间即最佳击打点。
 */
import { PART_BY_ID, partOfNote, type PartId } from "./laneLayouts";
import { drawHud, hexToRgba, type StageFrame } from "./stageRenderer";

/** 手部鼓面左→右顺序（按真实鼓组方位） */
const HAND_ORDER: readonly PartId[] = ["crash", "hihat", "snare", "highTom", "midTom", "floorTom", "ride"];
const PEDALS: readonly PartId[] = ["pedalHat", "kick"];

/** 当前显示集里的手部鼓面（左→右） */
export function flatHandParts(parts: readonly PartId[]): PartId[] {
  return HAND_ORDER.filter((p) => parts.includes(p));
}

/** 1x 速度下音符从顶部落到判定线所需毫秒；缩圈预告同长 */
const FALL_MS = 1800;
const RING_MS = 1100;
const FADE_MS = 220;

interface Geo {
  x0: number;
  laneW: number;
  hitY: number;
  topY: number;
  padR: number;
  pedalY: number;
  pedalX: [number, number];
}

function geometry(w: number, h: number, count: number): Geo {
  const usable = Math.min(w * 0.9, h * 1.9);
  const laneW = usable / Math.max(count, 1);
  const x0 = (w - usable) / 2;
  const hitY = h * 0.62;
  const pedalY = h * 0.84;
  const padR = Math.min(laneW * 0.34, h * 0.06);
  const gap = Math.min(w * 0.14, h * 0.32);
  return { x0, laneW, hitY, topY: h * 0.08, padR, pedalY, pedalX: [w / 2 - gap, w / 2 + gap] };
}

export function renderFlatLanes(ctx: CanvasRenderingContext2D, w: number, h: number, f: StageFrame) {
  const parts = f.parts ?? [];
  const hands = flatHandParts(parts);
  const g = geometry(w, h, hands.length);
  const now = f.now;

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#07070d");
  bg.addColorStop(1, "#14121c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 跑道
  hands.forEach((p, i) => {
    const color = PART_BY_ID[p].color;
    const x = g.x0 + i * g.laneW;
    const lg = ctx.createLinearGradient(0, g.topY, 0, g.hitY);
    lg.addColorStop(0, hexToRgba(color, 0));
    lg.addColorStop(1, hexToRgba(color, 0.14));
    ctx.fillStyle = lg;
    ctx.fillRect(x + 3, g.topY, g.laneW - 6, g.hitY - g.topY);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, g.topY);
    ctx.lineTo(x, g.hitY);
    ctx.stroke();
  });
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(g.x0 + hands.length * g.laneW, g.topY);
  ctx.lineTo(g.x0 + hands.length * g.laneW, g.hitY);
  ctx.stroke();

  // 判定线
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(g.x0, g.hitY);
  ctx.lineTo(g.x0 + hands.length * g.laneW, g.hitY);
  ctx.stroke();

  // 手部鼓面
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  hands.forEach((p, i) => {
    const part = PART_BY_ID[p];
    const cx = g.x0 + (i + 0.5) * g.laneW;
    const flash = Math.max(0, ((f.flashes[p] ?? 0) - now) / 200);
    drawPad(ctx, cx, g.hitY, g.padR, part.color, flash);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `${Math.max(10, g.padR * 0.32)}px sans-serif`;
    ctx.fillText(part.labelEn, cx, g.hitY + g.padR + 14);
  });

  // 踏板
  PEDALS.forEach((p, i) => {
    if (!parts.includes(p)) return;
    const part = PART_BY_ID[p];
    const flash = Math.max(0, ((f.flashes[p] ?? 0) - now) / 200);
    drawPad(ctx, g.pedalX[i]!, g.pedalY, g.padR * 0.9, part.color, flash);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `${Math.max(10, g.padR * 0.3)}px sans-serif`;
    ctx.fillText(part.labelEn, g.pedalX[i]!, g.pedalY + g.padR + 12);
  });

  // 音符
  if (f.showNotes !== false) {
    const fall = FALL_MS / Math.max(0.25, f.speed);
    const ring = RING_MS / Math.max(0.25, f.speed);
    const notes = f.chart.notes;
    const t = f.timeMs;
    const judged = f.noteJudgements;
    const judgedAt = f.noteJudgementAt;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]!;
      const dt = n.timeMs - t;
      if (dt > fall) break;
      if (dt < -400) continue;
      const p = n.note !== undefined ? partOfNote(n.note) : null;
      if (!p) continue;
      const state = judged?.[i] ?? 0;
      let alpha = 1;
      if (state !== 0) {
        const at = judgedAt?.[i] ?? 0;
        alpha = 1 - (now - at) / FADE_MS;
        if (state === 1 || alpha <= 0) continue;
      }
      const color = PART_BY_ID[p].color;
      const pi = PEDALS.indexOf(p);
      if (pi >= 0) {
        if (!parts.includes(p) || dt > ring) continue;
        const r0 = g.padR * 0.9;
        const k = Math.max(0, dt / ring);
        const r = r0 * (1 + k * 2.2);
        ctx.globalAlpha = Math.max(0, alpha) * (1 - k * 0.6);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, r0 * 0.14);
        ctx.beginPath();
        ctx.arc(g.pedalX[pi]!, g.pedalY, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      const li = hands.indexOf(p);
      if (li < 0) continue;
      const y = g.hitY - (dt / fall) * (g.hitY - g.topY);
      if (y < g.topY) continue;
      const cx = g.x0 + (li + 0.5) * g.laneW;
      const nw = g.laneW * 0.7;
      const nh = Math.max(10, g.padR * 0.34);
      ctx.globalAlpha = Math.max(0, alpha) * (state === 2 ? 0.5 : 1);
      ctx.fillStyle = color;
      roundRect(ctx, cx - nw / 2, y - nh / 2, nw, nh, nh / 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      roundRect(ctx, cx - nw / 2 + 4, y - nh / 2 + 2, nw - 8, nh * 0.35, nh / 4);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  drawHud(ctx, w, h, f);
}

function drawPad(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, flash: number) {
  ctx.save();
  ctx.fillStyle = hexToRgba(color, 0.18 + flash * 0.5);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, r * 0.1);
  if (flash > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 24 * flash;
  }
  ctx.beginPath();
  ctx.arc(x, y, r * (1 + flash * 0.08), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 方案 A：偏航角 -80°~+80° 按手部鼓面数均分扇区 */
export function flatPartOfYaw(yaw: number, hands: readonly PartId[]): PartId | null {
  if (hands.length === 0) return null;
  const t = (Math.max(-80, Math.min(79.999, yaw)) + 80) / 160;
  return hands[Math.floor(t * hands.length)] ?? null;
}
