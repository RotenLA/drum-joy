/**
 * 横排下落式渲染器（按参考画面逐像素标定）。
 *
 * 静态画面（天空光束、线框山峰、两侧阶梯、六边形框、五条双线跑道、
 * 金色判定线与四个菱形、底部五个箭头判定块、脚印）直接使用从参考视频
 * 截取并清理过的底图 columns-stage.jpg；所有动态元素（音符、命中高亮、
 * 动态音符）在同一 1564×720 参考坐标系里按实测坐标绘制，保证完全重合。
 */
import plateUrl from "@/assets/columns-stage.jpg";
import { PART_BY_ID, partOfNote, type PartId } from "./laneLayouts";
import { quality } from "./perf";
import { drawHud, hexToRgba, stageViewport, type StageFrame } from "./stageRenderer";

/* ---------------- 参考坐标系（1564×720，全部实测） ---------------- */
const REF_W = 1564;
const REF_H = 720;
/** 跑道线汇聚的地平线 y */
const HORIZON_Y = 172;
/** 十根跑道线：x = c + k·y（左外单线、四组双线、右外单线） */
const RAILS: readonly [number, number][] = [
  [856.54, -0.739], [829.51, -0.4659], [824.62, -0.4376], [798.4, -0.1598], [793.11, -0.1328],
  [768.59, 0.136], [763.54, 0.1629], [737.44, 0.4405], [732.47, 0.4686], [706.7, 0.7395],
];
/** 底部五个判定块：上沿 y、下沿 y、上沿左右 x */
const PAD_TOP = 601;
const PAD_BOTTOM = 630;
const PAD_X: readonly [number, number][] = [[418, 544], [570, 695], [720, 845], [870, 995], [1020, 1146]];
const PAD_HIT_Y = (PAD_TOP + PAD_BOTTOM) / 2;
/** 上排四个菱形：中心 x、中心 y、半宽、半高 */
const DIAMONDS: readonly [number, number, number, number][] = [
  [478.5, 393.5, 26.5, 27.5], [783.5, 396, 27.5, 31], [928, 396, 27, 31], [1082.5, 392.5, 24.5, 26.5],
];
/** 音符厚度 = (y - 地平线) × 系数（由判定块与参考音符实测） */
const THICK = 0.066;
/** 1x 从地平线到判定点的下落时长；速度倍率按反比缩短该时长。 */
const LEAD_MS = 2200;
const FLASH_MS = 200;

const GOLD = "#ffd84a";

const BOTTOM_SLOTS: readonly (PartId | null)[] = [null, "hihat", "snare", "kick", "floorTom"];
const TOP_SLOTS: readonly PartId[] = ["crash", "highTom", "midTom", "ride"];

interface Slot { row: 0 | 1; index: number }
interface Xf { s: number; tx: number; ty: number }
interface Placed {
  row: 0 | 1; index: number; timeMs: number; label: string | null;
  color: string;
  /** 参考坐标 */
  cx: number; cy: number; halfW: number; halfH: number; alpha: number;
}

let plate: HTMLImageElement | null = null;
function plateImage(): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  if (!plate) {
    plate = new Image();
    plate.decoding = "async";
    plate.src = plateUrl;
  }
  return plate.complete && plate.naturalWidth > 0 ? plate : null;
}

function slotOf(part: PartId): Slot | null {
  if (part === "pedalHat") return { row: 1, index: 1 };
  const bottom = BOTTOM_SLOTS.indexOf(part);
  if (bottom >= 0) return { row: 1, index: bottom };
  const top = TOP_SLOTS.indexOf(part);
  return top >= 0 ? { row: 0, index: top } : null;
}

function hatLabel(part: PartId, note: number | undefined): string | null {
  if (part === "pedalHat") return "Foot";
  if (part !== "hihat") return null;
  return note === 46 ? "Open" : "Closed";
}

function railX(i: number, y: number): number {
  const r = RAILS[i] ?? [782, 0];
  return r[0] + r[1] * y;
}

/** 参考坐标 → 画布坐标：以高度为主等比缩放、水平居中；过窄时保证跑道完整。 */
function transformOf(w: number, h: number): Xf {
  let s = Math.max(w / REF_W, h / REF_H);
  s = Math.min(s, w / 1180);
  const tx = (w - REF_W * s) / 2;
  const ty = (h - REF_H * s) * 0.6;
  return { s, tx, ty };
}
const X = (t: Xf, x: number) => t.tx + x * t.s;
const Y = (t: Xf, y: number) => t.ty + y * t.s;

function drawPlate(ctx: CanvasRenderingContext2D, w: number, h: number, t: Xf) {
  ctx.fillStyle = "#0b1428";
  ctx.fillRect(0, 0, w, h);
  const img = plateImage();
  if (img) ctx.drawImage(img, t.tx, t.ty, REF_W * t.s, REF_H * t.s);
  const top = t.ty, bottom = t.ty + REF_H * t.s;
  if (top > 0) {
    const g = ctx.createLinearGradient(0, 0, 0, top + 2);
    g.addColorStop(0, "#070d1c"); g.addColorStop(1, "#0f1a2e");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, top + 1);
  }
  if (bottom < h) {
    const g = ctx.createLinearGradient(0, bottom - 1, 0, h);
    g.addColorStop(0, "#0c1428"); g.addColorStop(1, "#050a16");
    ctx.fillStyle = g; ctx.fillRect(0, bottom - 1, w, h - bottom + 1);
  }
}

function downbeatPulse(f: StageFrame): number {
  if (!f.motionActive || f.timeMs < 0) return 0;
  const map = f.chart.beatMap;
  let nearest = Number.POSITIVE_INFINITY;
  if (map && map.beats.length) {
    for (let i = map.barPhase; i < map.beats.length; i += map.beatsPerBar) {
      const beat = map.beats[i];
      if (beat === undefined) continue;
      const d = Math.abs(f.timeMs - beat);
      if (d < nearest) nearest = d;
      if (beat > f.timeMs + 180) break;
    }
  } else {
    const grid = f.chart.grid;
    const barMs = grid
      ? grid.stepMs * grid.stepsPerBar
      : (60000 / Math.max(1, f.chart.bpm)) * Math.max(1, f.chart.timeSignature[0]);
    const origin = grid?.originMs ?? 0;
    nearest = Math.abs(f.timeMs - (origin + Math.round((f.timeMs - origin) / barMs) * barMs));
  }
  return nearest < 170 ? Math.pow(1 - nearest / 170, 2) : 0;
}

/** 参考底图上叠加轻量动态层；不移动跑道与判定坐标。 */
function drawReactiveBackdrop(ctx: CanvasRenderingContext2D, t: Xf, f: StageFrame) {
  if (!f.motionActive || quality.tier === "low") return;
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  const energy = Math.max(0, Math.min(1, f.audioEnergy ?? 0));
  const clock = f.now * 0.001;
  const high = quality.tier === "high";
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  // 顶部光束与地平线光晕缓慢扫动。
  const sweep = Math.sin(clock * 0.55) * 48;
  const halo = ctx.createRadialGradient(X(t, 782 + sweep), Y(t, 169), 0, X(t, 782 + sweep), Y(t, 169), 210 * t.s);
  halo.addColorStop(0, `rgba(125,226,255,${0.12 + energy * 0.12})`);
  halo.addColorStop(1, "rgba(125,226,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(X(t, 480), Y(t, 50), 604 * t.s, 260 * t.s);
  ctx.strokeStyle = `rgba(125,226,255,${0.07 + energy * 0.09})`;
  ctx.lineWidth = 3 * t.s;
  for (let i = -2; i <= 2; i++) {
    const sway = Math.sin(clock * 0.42 + i) * 35;
    ctx.beginPath();
    ctx.moveTo(X(t, 782 + sweep * 0.25), Y(t, 170));
    ctx.lineTo(X(t, 782 + i * 240 + sway), Y(t, 15));
    ctx.stroke();
  }

  // 两侧频谱能量条：固定数量、低频采样结果驱动高度，避免每帧分配数组。
  const bars = high ? 34 : 20;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < bars; i++) {
      const p = i / Math.max(1, bars - 1);
      const y = 210 + p * 410;
      const wave = 0.55 + 0.45 * Math.sin(clock * 4.2 + i * 0.83 + side);
      const amp = 10 + (18 + energy * 58) * wave * (0.45 + p * 0.55);
      const inner = side < 0 ? railX(0, y) - 25 : railX(9, y) + 25;
      ctx.strokeStyle = `rgba(104,205,255,${0.08 + energy * 0.16})`;
      ctx.lineWidth = Math.max(1, 2.2 * t.s);
      ctx.beginPath();
      ctx.moveTo(X(t, inner), Y(t, y));
      ctx.lineTo(X(t, inner + side * amp), Y(t, y - 4));
      ctx.stroke();
    }
  }

  // 山峰轮廓沿原轮廓附近缓慢漂移，保持参考构图而产生流动感。
  if (high) {
    ctx.strokeStyle = `rgba(122,196,255,${0.07 + energy * 0.08})`;
    ctx.lineWidth = 1.4 * t.s;
    for (let side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      for (let i = 0; i <= 11; i++) {
        const p = i / 11;
        const x = 782 + side * (360 + p * 420) + Math.sin(clock * 0.65 + i) * 9;
        const y = 154 + p * 130 - Math.sin(i * 1.72 + clock * 0.8) * (18 + energy * 15);
        if (i === 0) ctx.moveTo(X(t, x), Y(t, y)); else ctx.lineTo(X(t, x), Y(t, y));
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawTopGuides(ctx: CanvasRenderingContext2D, t: Xf) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.lineWidth = 1.5 * t.s;
  for (let i = 0; i < DIAMONDS.length; i++) {
    const d = DIAMONDS[i];
    if (!d) continue;
    const g = ctx.createLinearGradient(X(t, 782), Y(t, HORIZON_Y), X(t, d[0]), Y(t, d[1]));
    g.addColorStop(0, "rgba(123,223,255,0.12)");
    g.addColorStop(1, "rgba(123,223,255,0.56)");
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(X(t, 782), Y(t, HORIZON_Y));
    ctx.lineTo(X(t, d[0]), Y(t, d[1]));
    ctx.stroke();
  }
  ctx.restore();
}

function hitAmount(f: StageFrame, part: PartId | null): number {
  if (!part) return 0;
  const exp = Math.max(f.flashes[part] ?? 0, part === "hihat" ? f.flashes["pedalHat"] ?? 0 : 0);
  return Math.max(0, Math.min(1, (exp - f.now) / FLASH_MS));
}
function missAmount(f: StageFrame, part: PartId | null): number {
  if (!part) return 0;
  const exp = Math.max(f.missFlashes?.[part] ?? 0, part === "hihat" ? f.missFlashes?.["pedalHat"] ?? 0 : 0);
  return Math.max(0, Math.min(1, (exp - f.now) / 240));
}

function padPath(ctx: CanvasRenderingContext2D, t: Xf, i: number) {
  const [l, r] = PAD_X[i] ?? [0, 0];
  const kl = RAILS[i * 2]?.[1] ?? 0, kr = RAILS[i * 2 + 1]?.[1] ?? 0;
  const dy = PAD_BOTTOM - PAD_TOP;
  ctx.beginPath();
  ctx.moveTo(X(t, l), Y(t, PAD_TOP));
  ctx.lineTo(X(t, r), Y(t, PAD_TOP));
  ctx.lineTo(X(t, r + kr * dy), Y(t, PAD_BOTTOM));
  ctx.lineTo(X(t, l + kl * dy), Y(t, PAD_BOTTOM));
  ctx.closePath();
}

function diamondPath(ctx: CanvasRenderingContext2D, t: Xf, cx: number, cy: number, hw: number, hh: number) {
  ctx.beginPath();
  ctx.moveTo(X(t, cx), Y(t, cy - hh));
  ctx.lineTo(X(t, cx + hw), Y(t, cy - 2.5));
  ctx.lineTo(X(t, cx + hw), Y(t, cy + 2.5));
  ctx.lineTo(X(t, cx), Y(t, cy + hh));
  ctx.lineTo(X(t, cx - hw), Y(t, cy + 2.5));
  ctx.lineTo(X(t, cx - hw), Y(t, cy - 2.5));
  ctx.closePath();
}

/** 命中/失误时在底图的判定块与菱形上叠加高亮（静止时完全不画，保持与参考一致）。 */
function drawTargetsFeedback(ctx: CanvasRenderingContext2D, t: Xf, f: StageFrame, glow: boolean) {
  for (let i = 0; i < 5; i++) {
    const part = BOTTOM_SLOTS[i] ?? null;
    const hit = hitAmount(f, part), miss = missAmount(f, part);
    if (!hit && !miss) continue;
    ctx.save();
    padPath(ctx, t, i);
    ctx.fillStyle = miss && !hit ? `rgba(248,113,113,${0.35 * miss})` : hexToRgba(GOLD, 0.2 + hit * 0.45);
    ctx.shadowColor = miss && !hit ? "#f87171" : GOLD;
    ctx.shadowBlur = glow ? 18 * Math.max(hit, miss) * t.s : 0;
    ctx.fill();
    ctx.strokeStyle = hexToRgba("#fff6c4", 0.5 + hit * 0.5);
    ctx.lineWidth = 1.6 * t.s;
    ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < 4; i++) {
    const part = TOP_SLOTS[i] ?? null;
    const hit = hitAmount(f, part), miss = missAmount(f, part);
    if (!hit && !miss) continue;
    const d = DIAMONDS[i]; if (!d) continue;
    ctx.save();
    diamondPath(ctx, t, d[0], d[1], d[2], d[3]);
    ctx.fillStyle = miss && !hit ? `rgba(248,113,113,${0.35 * miss})` : hexToRgba(GOLD, 0.18 + hit * 0.5);
    ctx.shadowColor = miss && !hit ? "#f87171" : GOLD;
    ctx.shadowBlur = glow ? 16 * Math.max(hit, miss) * t.s : 0;
    ctx.fill();
    ctx.strokeStyle = hexToRgba("#fff6c4", 0.55 + hit * 0.45);
    ctx.lineWidth = 1.5 * t.s;
    ctx.stroke();
    ctx.restore();
  }
}

/** 时间 → 线性画面进度；0 为地平线，1 为判定点。 */
function fallProgress(dtMs: number, speed: number): number {
  return 1 - (dtMs * speed) / LEAD_MS;
}

function placeNotes(f: StageFrame): Placed[] {
  const out: Placed[] = [];
  const bottomD = PAD_HIT_Y - HORIZON_Y;
  for (const n of f.chart.notes) {
    if (n.note === undefined) continue;
    const part = partOfNote(n.note);
    const slot = part ? slotOf(part) : null;
    if (!part || !slot) continue;
    const progress = fallProgress(n.timeMs - f.timeMs, f.speed);
    if (progress < 0 || progress > 1.08) continue;
    const alpha = Math.min(1, progress * 8);
    const color = PART_BY_ID[part].color;
    if (slot.row === 1) {
      const y = HORIZON_Y + bottomD * progress;
      const l = railX(slot.index * 2, y), r = railX(slot.index * 2 + 1, y);
      const halfH = (y - HORIZON_Y) * THICK * 0.5;
      out.push({
        row: 1, index: slot.index, timeMs: n.timeMs, label: hatLabel(part, n.note),
        color, cx: (l + r) / 2, cy: y, halfW: (r - l) / 2 - 1, halfH, alpha,
      });
    } else {
      const d = DIAMONDS[slot.index]; if (!d) continue;
      const topD = d[1] - HORIZON_Y;
      const y = HORIZON_Y + topD * progress;
      const cx = 782 + (d[0] - 782) * progress;
      out.push({
        row: 0, index: slot.index, timeMs: n.timeMs, label: null,
        color, cx, cy: y, halfW: d[2] * 0.82 * progress, halfH: d[3] * 0.82 * progress, alpha,
      });
    }
  }
  return out.sort((a, b) => a.cy - b.cy);
}

function drawBar(ctx: CanvasRenderingContext2D, t: Xf, n: Placed, glow: boolean) {
  const yNear = n.cy + n.halfH, yFar = n.cy - n.halfH;
  const leftFar = railX(n.index * 2, yFar) + 1, rightFar = railX(n.index * 2 + 1, yFar) - 1;
  const leftNear = railX(n.index * 2, yNear) + 1, rightNear = railX(n.index * 2 + 1, yNear) - 1;
  const x0 = Math.min(X(t, leftFar), X(t, leftNear)), x1 = Math.max(X(t, rightFar), X(t, rightNear));
  const y0 = Y(t, yFar), y1 = Y(t, yNear);
  const w = Math.max(1, X(t, rightNear) - X(t, leftNear)), h = Math.max(1.5, y1 - y0);
  ctx.save();
  ctx.globalAlpha = n.alpha;
  ctx.shadowColor = n.color; ctx.shadowBlur = glow ? Math.max(3, h * 0.9) : 0;
  const body = ctx.createLinearGradient(0, y0, 0, y1);
  body.addColorStop(0, hexToRgba(n.color, 0.68)); body.addColorStop(0.5, n.color); body.addColorStop(1, hexToRgba(n.color, 0.72));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(X(t, leftFar), y0); ctx.lineTo(X(t, rightFar), y0);
  ctx.lineTo(X(t, rightNear), y1); ctx.lineTo(X(t, leftNear), y1); ctx.closePath(); ctx.fill();
  ctx.clip();
  ctx.shadowBlur = 0;
  // 中央高亮，不再画白色外框。
  if (h > 4) {
    const midY = (y0 + y1) / 2;
    const shine = ctx.createLinearGradient(0, y0, 0, y1);
    shine.addColorStop(0, "rgba(255,255,255,0)");
    shine.addColorStop(0.5, "rgba(255,255,255,0.68)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(x0 + w * 0.04, midY - h * 0.23, Math.max(1, x1 - x0 - w * 0.08), h * 0.46);
  }
  if (n.label && h > 5) {
    const fs = h * 0.78;
    ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `italic 500 ${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(n.label).width, max = (x1 - x0) * 0.78;
    if (tw > max) ctx.scale(max / tw, 1);
    ctx.fillStyle = "rgba(12,16,24,0.9)";
    ctx.fillText(n.label, 0, fs * 0.04);
  }
  ctx.restore();
}

function drawDiamondNote(ctx: CanvasRenderingContext2D, t: Xf, n: Placed, glow: boolean) {
  const cx = X(t, n.cx), cy = Y(t, n.cy), hw = Math.max(1.5, n.halfW * t.s), hh = Math.max(1.5, n.halfH * t.s);
  ctx.save();
  ctx.globalAlpha = n.alpha;
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx - hw, cy); ctx.closePath();
  const g = ctx.createLinearGradient(cx - hw, cy, cx + hw, cy);
  g.addColorStop(0, hexToRgba(n.color, 0.68)); g.addColorStop(0.5, "rgba(255,255,255,0.74)"); g.addColorStop(1, hexToRgba(n.color, 0.72));
  ctx.fillStyle = g; ctx.shadowColor = n.color; ctx.shadowBlur = glow ? Math.max(3, hh * 0.6) : 0; ctx.fill();
  ctx.restore();
}

function drawBeatTargets(ctx: CanvasRenderingContext2D, t: Xf, f: StageFrame) {
  const pulse = downbeatPulse(f);
  if (pulse <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = hexToRgba(GOLD, 0.22 + pulse * 0.42);
  ctx.lineWidth = (1.2 + pulse * 1.4) * t.s;
  ctx.shadowColor = GOLD;
  ctx.shadowBlur = quality.params.glow ? 10 * pulse * t.s : 0;
  for (let i = 0; i < 5; i++) {
    const [l, r] = PAD_X[i] ?? [0, 0];
    const cx = (l + r) / 2, cy = PAD_HIT_Y, s = 1 + pulse * 0.035;
    ctx.save(); ctx.translate(X(t, cx), Y(t, cy)); ctx.scale(s, s); ctx.translate(-X(t, cx), -Y(t, cy));
    padPath(ctx, t, i); ctx.stroke(); ctx.restore();
  }
  for (const d of DIAMONDS) {
    const s = 1 + pulse * 0.055;
    ctx.save(); ctx.translate(X(t, d[0]), Y(t, d[1])); ctx.scale(s, s); ctx.translate(-X(t, d[0]), -Y(t, d[1]));
    diamondPath(ctx, t, d[0], d[1], d[2], d[3]); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
}

export function renderColumns(ctx: CanvasRenderingContext2D, w: number, h: number, f: StageFrame) {
  const glow = quality.params.glow;
  const t = transformOf(w, h);
  ctx.save();
  drawPlate(ctx, w, h, t);
  drawReactiveBackdrop(ctx, t, f);
  drawTopGuides(ctx, t);
  drawBeatTargets(ctx, t, f);
  drawTargetsFeedback(ctx, t, f, glow);
  if (f.showNotes !== false) {
    const placed = placeNotes(f);
    for (const n of placed) {
      if (n.row === 1) drawBar(ctx, t, n, glow); else drawDiamondNote(ctx, t, n, glow);
    }
  }
  ctx.restore();
  const v = stageViewport(w, h);
  ctx.save(); ctx.translate(v.x, v.y); drawHud(ctx, v.w, v.h, f); ctx.restore();
}

/** 供校验脚本使用：参考坐标系常量。 */
export const COLUMNS_REF = { REF_W, REF_H, HORIZON_Y, PAD_HIT_Y } as const;
