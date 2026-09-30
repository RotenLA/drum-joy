/**
 * 横排下落式渲染器（经典透视车道）
 *
 * 纯 Canvas 2D 伪 3D，与 React 解耦，与舞台模式共用 StageFrame 数据。
 * 几何严格对标参考截图（1920x891 量取后归一化）：
 *  - 消失点 VP(0.5, 0.235)，5 条窄透视车道，车道面暗色不上色，仅青色细轨线；
 *  - 上层判定线 y=0.545：一条橙黄横线 + 4 个空心菱形（吊镲/高通/中通/叮叮镲）；
 *  - 下层判定排 y=0.853：5 个直角矩形打击盘，盘内满铺黄色双向箭头；
 *      槽位 0 无（占位，不排音符）／1 开闭镲（Closed/Open/Foot）
 *      2 军鼓／3 右踏板（底鼓）／4 低通；槽位 1、3 下方画脚印；
 *  - 音符＝沿车道透视的梯形块（远小近大、上窄下宽），开闭镲叠字；
 *  - 上下两排同刻音符之间画连线，同一排不连线；
 *  - 与难度无关，9 个部件结构始终完整显示。
 */
import { PART_BY_ID, partOfNote, type PartId } from "./laneLayouts";
import { quality } from "./perf";
import { drawHud, hexToRgba, stageViewport, type StageFrame } from "./stageRenderer";

/** 消失点（归一化，相对视口） */
const VP = { x: 0.5, y: 0.235 };
/** 下层打击盘中心线 */
const BOTTOM_Y = 0.853;
/** 上层判定线 */
const TOP_Y = 0.545;
/** 赛道横向范围（判定排处） */
const SPAN_L = 0.258;
const SPAN_R = 0.747;

/** 音符从消失点飞到判定线的时间（1x 速度，毫秒） */
const LEAD_MS = 2000;
/** 透视加速指数 */
const EASE = 1.9;
/** 命中闪光时长（与 FallScreen 的 FLASH_MS 对应） */
const FLASH_MS = 200;
/** 音符在深度方向上的厚度（p 空间） */
const NOTE_DEPTH = 0.052;

const BOTTOM_SLOTS: readonly (PartId | null)[] = [null, "hihat", "snare", "kick", "floorTom"];
const TOP_SLOTS: readonly PartId[] = ["crash", "highTom", "midTom", "ride"];
/** 带脚印标记的下层列（开闭镲踏板、右踏板底鼓） */
const FOOT_SLOTS = new Set([1, 3]);

const ACCENT = "#FFC300";
const RAIL = "#37E6F5";

interface Slot {
  row: 0 | 1;
  index: number;
}

/** 部件 → 槽位；开闭镲踏板与开闭镲共用第 1 列 */
function slotOf(part: PartId): Slot | null {
  if (part === "pedalHat") return { row: 1, index: 1 };
  const bottom = BOTTOM_SLOTS.indexOf(part);
  if (bottom >= 0) return { row: 1, index: bottom };
  const top = TOP_SLOTS.indexOf(part);
  if (top >= 0) return { row: 0, index: top };
  return null;
}

/** 开闭镲音符标注 */
function hatLabel(part: PartId, note: number | undefined): string | null {
  if (part === "pedalHat") return "Foot";
  if (part !== "hihat") return null;
  if (note === 46) return "Open";
  return "Closed";
}

interface Geom {
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** 车道左右边界 x（判定排处，6 个值） */
  edgeX: number[];
  /** 下层列中心 x（槽位 0~4） */
  bottomX: number[];
  bottomY: number;
  bottomW: number;
  /** 上层菱形中心 x（槽位 0~3） */
  topX: number[];
  topY: number;
  topW: number;
  topLeft: number;
  topRight: number;
}

let geomKey = "";
let geomCache: Geom | null = null;

function geomOf(w: number, h: number): Geom {
  const key = `${Math.round(w)}x${Math.round(h)}`;
  if (geomCache && key === geomKey) return geomCache;
  const left = SPAN_L * w;
  const right = SPAN_R * w;
  const bottomW = (right - left) / BOTTOM_SLOTS.length;
  const topW = (right - left) / TOP_SLOTS.length;
  const g: Geom = {
    w,
    h,
    vx: VP.x * w,
    vy: VP.y * h,
    edgeX: Array.from({ length: BOTTOM_SLOTS.length + 1 }, (_, i) => left + i * bottomW),
    bottomX: BOTTOM_SLOTS.map((_, i) => left + (i + 0.5) * bottomW),
    bottomY: BOTTOM_Y * h,
    bottomW,
    topX: TOP_SLOTS.map((_, i) => left + (i + 0.5) * topW),
    topY: TOP_Y * h,
    topW,
    topLeft: left,
    topRight: right,
  };
  geomKey = key;
  geomCache = g;
  return g;
}

/** 沿车道从消失点到判定排的 x 插值 */
function laneX(g: Geom, xAtBottom: number, p: number): number {
  return g.vx + (xAtBottom - g.vx) * p;
}
function laneY(g: Geom, p: number): number {
  return g.vy + (g.bottomY - g.vy) * p;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// ================= 场景 =================

function drawScene(ctx: CanvasRenderingContext2D, g: Geom, now: number, glow: boolean) {
  const { w, h } = g;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#05080f");
  sky.addColorStop(0.3, "#0a1424");
  sky.addColorStop(0.62, "#0b1526");
  sky.addColorStop(1, "#050a12");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 消失点辐射光晕
  const halo = ctx.createRadialGradient(g.vx, g.vy, 0, g.vx, g.vy, w * 0.26);
  halo.addColorStop(0, hexToRgba(RAIL, 0.4));
  halo.addColorStop(0.25, hexToRgba(RAIL, 0.1));
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);

  // 远山线框（左右对称）
  ctx.save();
  ctx.strokeStyle = hexToRgba(RAIL, 0.22);
  ctx.lineWidth = 1;
  for (const dir of [-1, 1] as const) {
    ctx.beginPath();
    let x = g.vx + dir * w * 0.09;
    ctx.moveTo(x, g.vy);
    const peaks = [0.05, 0.035, 0.062, 0.04, 0.07, 0.045];
    for (let i = 0; i < peaks.length; i++) {
      const step = w * 0.055;
      x += dir * step;
      ctx.lineTo(x, g.vy - h * peaks[i]!);
      x += dir * step;
      ctx.lineTo(x, g.vy + h * 0.006);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 车道面（暗色，不上部件色，避免抢音符）
  ctx.save();
  const floor = ctx.createLinearGradient(0, g.vy, 0, h);
  floor.addColorStop(0, "rgba(20,44,66,0.0)");
  floor.addColorStop(0.55, "rgba(16,38,60,0.45)");
  floor.addColorStop(1, "rgba(10,24,40,0.75)");
  ctx.fillStyle = floor;
  ctx.beginPath();
  ctx.moveTo(g.vx, g.vy);
  ctx.lineTo(laneX(g, g.edgeX[0]!, (h - g.vy) / (g.bottomY - g.vy)), h);
  ctx.lineTo(laneX(g, g.edgeX[BOTTOM_SLOTS.length]!, (h - g.vy) / (g.bottomY - g.vy)), h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 两侧阶梯纹（参考图里跑道外侧的密集横条）
  ctx.save();
  ctx.strokeStyle = hexToRgba(RAIL, 0.16);
  ctx.lineWidth = 1;
  const flow = (now / 3400) % 1;
  for (let i = 1; i < 34; i++) {
    const p = Math.pow((i + flow) / 34, 2.1);
    const y = laneY(g, p);
    if (y > h) break;
    const inner = laneX(g, g.edgeX[0]!, p);
    const innerR = laneX(g, g.edgeX[BOTTOM_SLOTS.length]!, p);
    const len = (g.vx - inner) * 0.85;
    ctx.beginPath();
    ctx.moveTo(inner - len, y);
    ctx.lineTo(inner - len * 0.08, y);
    ctx.moveTo(innerR + len * 0.08, y);
    ctx.lineTo(innerR + len, y);
    ctx.stroke();
  }
  ctx.restore();

  // 车道分界：青色细轨线（外侧两条略亮，形成双轨感）
  ctx.save();
  ctx.shadowColor = RAIL;
  const pBottomEdge = (h - g.vy) / (g.bottomY - g.vy);
  for (let i = 0; i <= BOTTOM_SLOTS.length; i++) {
    const outer = i === 0 || i === BOTTOM_SLOTS.length;
    ctx.strokeStyle = hexToRgba(RAIL, outer ? 0.6 : 0.34);
    ctx.lineWidth = outer ? 1.6 : 1;
    ctx.shadowBlur = glow ? (outer ? 8 : 4) : 0;
    ctx.beginPath();
    ctx.moveTo(g.vx, g.vy);
    ctx.lineTo(laneX(g, g.edgeX[i]!, pBottomEdge), h);
    ctx.stroke();
  }
  ctx.restore();
}

/** 上层判定线：贯穿橙黄横线 + 4 个空心菱形 */
function drawTopRow(ctx: CanvasRenderingContext2D, g: Geom, f: StageFrame, glow: boolean) {
  ctx.save();
  ctx.strokeStyle = hexToRgba(ACCENT, 0.7);
  ctx.lineWidth = 1.6;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = glow ? 8 : 0;
  ctx.beginPath();
  ctx.moveTo(g.topLeft, g.topY);
  ctx.lineTo(g.topRight, g.topY);
  ctx.stroke();
  ctx.restore();

  const rx = g.topW * 0.29;
  const ry = rx * 0.5;
  for (let i = 0; i < TOP_SLOTS.length; i++) {
    const part = TOP_SLOTS[i]!;
    const color = PART_BY_ID[part].color;
    const x = g.topX[i]!;
    const expiry = f.flashes[part] ?? 0;
    const hit = Math.max(0, Math.min(1, (expiry - f.now) / FLASH_MS));
    const missExpiry = f.missFlashes?.[part] ?? 0;
    const miss = Math.max(0, Math.min(1, (missExpiry - f.now) / 240));
    ctx.save();
    ctx.translate(x, g.topY);
    ctx.scale(1 + hit * 0.14, 1 + hit * 0.14);
    ctx.beginPath();
    ctx.moveTo(0, -ry);
    ctx.lineTo(rx, 0);
    ctx.lineTo(0, ry);
    ctx.lineTo(-rx, 0);
    ctx.closePath();
    if (hit > 0) {
      ctx.fillStyle = hexToRgba(color, hit * 0.55);
      ctx.fill();
    }
    ctx.strokeStyle = miss > 0 ? hexToRgba("#f87171", 0.9) : hexToRgba(ACCENT, 0.85);
    ctx.lineWidth = 1.5;
    ctx.shadowColor = hit > 0 ? color : ACCENT;
    ctx.shadowBlur = glow ? 6 + hit * 16 : 0;
    ctx.stroke();
    ctx.restore();
  }
}

/** 下层打击盘：直角矩形 + 盘内满铺黄色双向箭头 + 脚印 */
function drawBottomRow(ctx: CanvasRenderingContext2D, g: Geom, f: StageFrame, glow: boolean) {
  const padW = g.bottomW * 0.94;
  const padH = Math.max(14, g.h * 0.042);
  for (let i = 0; i < BOTTOM_SLOTS.length; i++) {
    const part = BOTTOM_SLOTS[i];
    const x = g.bottomX[i]!;
    const expiry = part
      ? Math.max(f.flashes[part] ?? 0, part === "hihat" ? (f.flashes["pedalHat"] ?? 0) : 0)
      : 0;
    const hit = Math.max(0, Math.min(1, (expiry - f.now) / FLASH_MS));
    const missExpiry = part
      ? Math.max(
          f.missFlashes?.[part] ?? 0,
          part === "hihat" ? (f.missFlashes?.["pedalHat"] ?? 0) : 0,
        )
      : 0;
    const miss = Math.max(0, Math.min(1, (missExpiry - f.now) / 240));

    ctx.save();
    ctx.translate(x, g.bottomY);
    ctx.beginPath();
    ctx.rect(-padW / 2, -padH / 2, padW, padH);
    ctx.fillStyle = hit > 0 ? hexToRgba(ACCENT, 0.18 + hit * 0.45) : "rgba(8,14,24,0.7)";
    ctx.fill();
    ctx.strokeStyle = miss > 0 ? hexToRgba("#f87171", 0.95) : hexToRgba(ACCENT, 0.9);
    ctx.lineWidth = 1.8;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = glow ? 6 + hit * 16 : 0;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 盘内满铺箭头：左半 >>>，右半 <<<（参考图的斑马箭头）
    ctx.save();
    ctx.beginPath();
    ctx.rect(-padW / 2 + 1, -padH / 2 + 1, padW - 2, padH - 2);
    ctx.clip();
    ctx.strokeStyle = hexToRgba(ACCENT, 0.42 + hit * 0.5);
    ctx.lineWidth = Math.max(2, padH * 0.16);
    const aw = padH * 0.42;
    const gap = aw * 1.15;
    for (let k = 0; k < 3; k++) {
      const off = padW * 0.08 + k * gap;
      for (const dir of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(dir * off, -padH * 0.3);
        ctx.lineTo(dir * (off + aw * 0.7), 0);
        ctx.lineTo(dir * off, padH * 0.3);
        ctx.stroke();
      }
    }
    ctx.restore();

    // 脚印标记（开闭镲踏板列、底鼓列）
    if (FOOT_SLOTS.has(i)) {
      ctx.fillStyle = hexToRgba(ACCENT, 0.4);
      const fy = padH / 2 + padH * 0.7;
      ctx.beginPath();
      ctx.ellipse(0, fy, padW * 0.07, padH * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let t = 0; t < 4; t++) {
        ctx.beginPath();
        ctx.ellipse(
          (t - 1.5) * padW * 0.045,
          fy - padH * 0.52,
          padW * 0.017,
          padH * 0.1,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

// ================= 音符 =================

interface Quad {
  x0: number;
  x1: number;
  yFar: number;
  x2: number;
  x3: number;
  yNear: number;
  cx: number;
  cy: number;
  hPx: number;
  wPx: number;
}

interface Placed {
  part: PartId;
  row: 0 | 1;
  quad: Quad;
  color: string;
  label: string | null;
  timeMs: number;
  tailQuad: Quad | null;
}

/** 按车道透视求音符梯形（上窄下宽） */
function quadOf(g: Geom, slot: Slot, p: number): Quad {
  const pNear = Math.max(0.02, Math.min(1.04, p));
  const pFar = Math.max(0.015, pNear - NOTE_DEPTH * pNear);
  if (slot.row === 0) {
    // 上排：以菱形中心为锚，按深度缩放
    const scale = 0.16 + 0.84 * Math.min(1, pNear / ((g.topY - g.vy) / (g.bottomY - g.vy)));
    const cx = g.vx + (g.topX[slot.index]! - g.vx) * Math.min(1, scale);
    const cy = laneY(g, pNear);
    const rx = g.topW * 0.28 * scale;
    const ry = rx * 0.5;
    return {
      x0: cx - rx,
      x1: cx + rx,
      yFar: cy - ry,
      x2: cx - rx,
      x3: cx + rx,
      yNear: cy + ry,
      cx,
      cy,
      hPx: ry * 2,
      wPx: rx * 2,
    };
  }
  const lb = g.edgeX[slot.index]! + g.bottomW * 0.03;
  const rb = g.edgeX[slot.index + 1]! - g.bottomW * 0.03;
  const x0 = laneX(g, lb, pFar);
  const x1 = laneX(g, rb, pFar);
  const x2 = laneX(g, lb, pNear);
  const x3 = laneX(g, rb, pNear);
  const yFar = laneY(g, pFar);
  const yNear = laneY(g, pNear);
  return {
    x0,
    x1,
    yFar,
    x2,
    x3,
    yNear,
    cx: (x0 + x1 + x2 + x3) / 4,
    cy: (yFar + yNear) / 2,
    hPx: yNear - yFar,
    wPx: (x1 - x0 + x3 - x2) / 2,
  };
}

function placeNotes(g: Geom, f: StageFrame): Placed[] {
  const out: Placed[] = [];
  const topP = (g.topY - g.vy) / (g.bottomY - g.vy);
  for (const n of f.chart.notes) {
    if (n.note === undefined) continue;
    const part = partOfNote(n.note);
    if (!part) continue;
    const slot = slotOf(part);
    if (!slot) continue;
    const hold = n.holdMs && n.holdMs > 0 ? n.holdMs : 0;
    const t = 1 - ((n.timeMs - f.timeMs) * f.speed) / LEAD_MS;
    const tTail = hold ? 1 - ((n.timeMs + hold - f.timeMs) * f.speed) / LEAD_MS : t;
    if (t <= 0.02 || tTail >= 1) continue;
    // 上排判定点在跑道中段，因此深度按其所在位置归一
    const depth = (tt: number) =>
      Math.pow(Math.max(0.02, Math.min(1, tt)), EASE) * (slot.row === 0 ? topP : 1);
    out.push({
      part,
      row: slot.row,
      quad: quadOf(g, slot, depth(Math.min(t, 1))),
      color: PART_BY_ID[part].color,
      label: hatLabel(part, n.note),
      timeMs: n.timeMs,
      tailQuad: hold ? quadOf(g, slot, depth(Math.max(0.02, tTail))) : null,
    });
  }
  out.sort((a, b) => a.quad.cy - b.quad.cy);
  return out;
}

/** 上下两排同刻音符连线（同一排不连） */
function drawChordLinks(ctx: CanvasRenderingContext2D, placed: Placed[], glow: boolean) {
  const byTime = new Map<number, Placed[]>();
  for (const p of placed) {
    const key = Math.round(p.timeMs);
    const list = byTime.get(key);
    if (list) list.push(p);
    else byTime.set(key, [p]);
  }
  ctx.save();
  ctx.lineWidth = 1.6;
  for (const group of byTime.values()) {
    if (group.length < 2) continue;
    const tops = group.filter((p) => p.row === 0);
    const bottoms = group.filter((p) => p.row === 1);
    if (!tops.length || !bottoms.length) continue;
    for (const a of tops) {
      for (const b of bottoms) {
        const grad = ctx.createLinearGradient(a.quad.cx, a.quad.cy, b.quad.cx, b.quad.cy);
        grad.addColorStop(0, hexToRgba(a.color, 0.4));
        grad.addColorStop(1, hexToRgba(b.color, 0.4));
        ctx.strokeStyle = grad;
        ctx.shadowColor = hexToRgba(a.color, 0.5);
        ctx.shadowBlur = glow ? 6 : 0;
        ctx.beginPath();
        ctx.moveTo(a.quad.cx, a.quad.cy);
        ctx.lineTo(b.quad.cx, b.quad.cy);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function quadPath(ctx: CanvasRenderingContext2D, q: Quad) {
  ctx.beginPath();
  ctx.moveTo(q.x0, q.yFar);
  ctx.lineTo(q.x1, q.yFar);
  ctx.lineTo(q.x3, q.yNear);
  ctx.lineTo(q.x2, q.yNear);
  ctx.closePath();
}

function drawNote(ctx: CanvasRenderingContext2D, n: Placed, glow: boolean) {
  const q = n.quad;
  ctx.save();
  // 长按尾：从尾端到头部的车道带
  if (n.tailQuad) {
    const t = n.tailQuad;
    ctx.beginPath();
    ctx.moveTo(t.x0, t.yFar);
    ctx.lineTo(t.x1, t.yFar);
    ctx.lineTo(q.x3, q.yNear);
    ctx.lineTo(q.x2, q.yNear);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(n.color, 0.22);
    ctx.fill();
  }
  ctx.shadowColor = n.color;
  ctx.shadowBlur = glow ? 10 : 0;

  if (n.row === 0) {
    const rx = q.wPx / 2;
    const ry = q.hPx / 2;
    ctx.beginPath();
    ctx.moveTo(q.cx, q.cy - ry);
    ctx.lineTo(q.cx + rx, q.cy);
    ctx.lineTo(q.cx, q.cy + ry);
    ctx.lineTo(q.cx - rx, q.cy);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(n.color, 0.78);
    ctx.fill();
    ctx.strokeStyle = hexToRgba("#ffffff", 0.8);
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();
    return;
  }

  quadPath(ctx, q);
  const grad = ctx.createLinearGradient(0, q.yFar, 0, q.yNear);
  grad.addColorStop(0, hexToRgba(n.color, 0.95));
  grad.addColorStop(1, hexToRgba(n.color, 0.6));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = hexToRgba("#ffffff", 0.75);
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (n.label && q.hPx > 7) {
    const fs = Math.max(7, Math.round(q.hPx * 0.86));
    ctx.save();
    ctx.translate(q.cx, q.cy);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(n.label).width;
    const maxW = q.wPx * 0.86;
    if (tw > maxW) ctx.scale(maxW / tw, 1);
    ctx.lineWidth = Math.max(1.6, fs * 0.22);
    ctx.strokeStyle = "rgba(10,10,14,0.75)";
    ctx.strokeText(n.label, 0, 0);
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.fillText(n.label, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

// ================= 入口 =================

export function renderColumns(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  f: StageFrame,
) {
  const q = quality.params;
  const glow = q.glow;
  const v = stageViewport(w, h);

  ctx.save();
  ctx.fillStyle = "#050a12";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(v.x, v.y);
  ctx.beginPath();
  ctx.rect(0, 0, v.w, v.h);
  ctx.clip();

  const g = geomOf(v.w, v.h);
  drawScene(ctx, g, f.now, glow);
  drawTopRow(ctx, g, f, glow);
  drawBottomRow(ctx, g, f, glow);

  if (f.showNotes !== false) {
    const placed = placeNotes(g, f);
    drawChordLinks(ctx, placed, glow);
    for (const n of placed) drawNote(ctx, n, glow);
  }
  ctx.restore();

  ctx.save();
  ctx.translate(v.x, v.y);
  drawHud(ctx, v.w, v.h, f);
  ctx.restore();
}
