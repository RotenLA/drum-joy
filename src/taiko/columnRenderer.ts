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
  tail: { y: number; halfW: number } | null;
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
    let tail: Placed["tail"] = null;
    if (slot.row === 1) {
      const y = HORIZON_Y + bottomD * progress;
      const l = railX(slot.index * 2, y), r = railX(slot.index * 2 + 1, y);
      const halfH = (y - HORIZON_Y) * THICK * 0.5;
      if (n.holdMs) {
        const tailProgress = Math.max(0, Math.min(1.08, fallProgress(n.timeMs + n.holdMs - f.timeMs, f.speed)));
        const ty = HORIZON_Y + bottomD * tailProgress;
        tail = { y: ty, halfW: (railX(slot.index * 2 + 1, ty) - railX(slot.index * 2, ty)) * 0.5 - 1 };
      }
      out.push({
        row: 1, index: slot.index, timeMs: n.timeMs, label: hatLabel(part, n.note),
        color, cx: (l + r) / 2, cy: y, halfW: (r - l) / 2 - 1, halfH, alpha, tail,
      });
    } else {
      const d = DIAMONDS[slot.index]; if (!d) continue;
      const topD = d[1] - HORIZON_Y;
      const y = HORIZON_Y + topD * progress;
      const cx = 782 + (d[0] - 782) * progress;
      if (n.holdMs) {
        const tailProgress = Math.max(0, Math.min(1.08, fallProgress(n.timeMs + n.holdMs - f.timeMs, f.speed)));
        const ty = HORIZON_Y + topD * tailProgress;
        tail = { y: ty, halfW: d[2] * 0.35 * ((ty - HORIZON_Y) / topD) };
      }
      out.push({
        row: 0, index: slot.index, timeMs: n.timeMs, label: null,
        color, cx, cy: y, halfW: d[2] * 0.82 * progress, halfH: d[3] * 0.82 * progress, alpha, tail,
      });
    }
  }
  return out.sort((a, b) => a.cy - b.cy);
}

function drawBar(ctx: CanvasRenderingContext2D, t: Xf, n: Placed, glow: boolean) {
  const x0 = X(t, n.cx - n.halfW), x1 = X(t, n.cx + n.halfW);
  const y0 = Y(t, n.cy - n.halfH), y1 = Y(t, n.cy + n.halfH);
  const w = x1 - x0, h = Math.max(1.5, y1 - y0);
  if (n.tail) {
    const ty = Y(t, n.tail.y), thw = n.tail.halfW * t.s, cx = X(t, n.cx);
    ctx.save(); ctx.globalAlpha = n.alpha * 0.28; ctx.fillStyle = n.color;
    ctx.beginPath(); ctx.moveTo(cx - thw, ty); ctx.lineTo(cx + thw, ty); ctx.lineTo(x1, y0); ctx.lineTo(x0, y0); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = n.alpha;
  // 外层橙色发光底
  ctx.shadowColor = n.color; ctx.shadowBlur = glow ? Math.max(3, h * 0.9) : 0;
  const body = ctx.createLinearGradient(0, y0, 0, y1);
  body.addColorStop(0, hexToRgba(n.color, 0.72)); body.addColorStop(0.5, n.color); body.addColorStop(1, hexToRgba(n.color, 0.68));
  ctx.fillStyle = body; ctx.fillRect(x0, y0, w, h);
  ctx.shadowBlur = 0;
  // 内层浅色牌面 + 亮边
  if (h > 4) {
    const ix = w * 0.035, iy = h * 0.2;
    const face = ctx.createLinearGradient(0, y0 + iy, 0, y1 - iy);
    face.addColorStop(0, hexToRgba(n.color, 0.42)); face.addColorStop(0.55, hexToRgba(n.color, 0.72)); face.addColorStop(1, hexToRgba(n.color, 0.9));
    ctx.fillStyle = face; ctx.fillRect(x0 + ix, y0 + iy, w - ix * 2, h - iy * 2);
    ctx.strokeStyle = "rgba(255,250,225,0.95)"; ctx.lineWidth = Math.max(0.8, h * 0.06);
    ctx.strokeRect(x0 + ix, y0 + iy, w - ix * 2, h - iy * 2);
  } else {
    ctx.strokeStyle = "rgba(255,230,180,0.9)"; ctx.lineWidth = 0.8; ctx.strokeRect(x0, y0, w, h);
  }
  if (n.label && h > 5) {
    const fs = h * 0.78;
    ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `italic 500 ${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(n.label).width, max = w * 0.74;
    if (tw > max) ctx.scale(max / tw, 1);
    ctx.fillStyle = "rgba(12,16,24,0.9)";
    ctx.fillText(n.label, 0, fs * 0.04);
  }
  ctx.restore();
}

function drawDiamondNote(ctx: CanvasRenderingContext2D, t: Xf, n: Placed, glow: boolean) {
  if (n.tail) {
    ctx.save(); ctx.globalAlpha = n.alpha * 0.28; ctx.fillStyle = n.color;
    const ty = Y(t, n.tail.y), thw = n.tail.halfW * t.s, cx = X(t, n.cx), hw = n.halfW * 0.35 * t.s;
    ctx.beginPath(); ctx.moveTo(cx - thw, ty); ctx.lineTo(cx + thw, ty); ctx.lineTo(cx + hw, Y(t, n.cy)); ctx.lineTo(cx - hw, Y(t, n.cy)); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const cx = X(t, n.cx), cy = Y(t, n.cy), hw = Math.max(1.5, n.halfW * t.s), hh = Math.max(1.5, n.halfH * t.s);
  ctx.save();
  ctx.globalAlpha = n.alpha;
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx - hw, cy); ctx.closePath();
  const g = ctx.createLinearGradient(0, cy - hh, 0, cy + hh);
  g.addColorStop(0, hexToRgba(n.color, 0.62)); g.addColorStop(0.5, n.color); g.addColorStop(1, hexToRgba(n.color, 0.7));
  ctx.fillStyle = g; ctx.shadowColor = n.color; ctx.shadowBlur = glow ? Math.max(3, hh * 0.6) : 0; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,248,220,0.95)"; ctx.lineWidth = Math.max(0.8, hh * 0.08); ctx.stroke();
  ctx.restore();
}

export function renderColumns(ctx: CanvasRenderingContext2D, w: number, h: number, f: StageFrame) {
  const glow = quality.params.glow;
  const t = transformOf(w, h);
  ctx.save();
  drawPlate(ctx, w, h, t);
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
