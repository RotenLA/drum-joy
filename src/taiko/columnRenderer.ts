/**
 * 横排下落式渲染器（经典透视车道）
 *
 * 纯 Canvas 2D 伪 3D，与 React 解耦，与舞台模式共用 StageFrame 数据。
 * 结构对标参考视频：
 *  - 顶部中心消失点辐射出 5 条透视车道；
 *  - 下层判定排 = 5 个带黄色箭头的打击盘：
 *      0 无（占位，不排音符）／1 开闭镲（Closed/Open/Foot，与左踏板合一）
 *      2 军鼓／3 右踏板（底鼓）／4 低通；第 1、3 列画脚印标记；
 *  - 上层判定线 = 4 个菱形：吊镲、高通、中通、叮叮镲；
 *  - 上下两排同刻音符之间画连线，同一排不连线；
 *  - 与难度无关，9 个部件结构始终完整显示。
 */
import { PART_BY_ID, partOfNote, type PartId } from "./laneLayouts";
import { quality } from "./perf";
import { drawHud, hexToRgba, stageViewport, type StageFrame } from "./stageRenderer";

/** 消失点（归一化，相对视口） */
const VP = { x: 0.5, y: 0.2 };
/** 下层打击盘中心线 */
const BOTTOM_Y = 0.855;
/** 上层判定线 */
const TOP_Y = 0.552;
/** 赛道横向范围 */
const SPAN_L = 0.25;
const SPAN_R = 0.75;

/** 音符从消失点飞到判定线的时间（1x 速度，毫秒） */
const LEAD_MS = 2000;
/** 透视加速指数 */
const EASE = 1.7;
/** 命中闪光时长（与 FallScreen 的 FLASH_MS 对应） */
const FLASH_MS = 200;

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
  /** 下层列中心 x（槽位 0~4） */
  bottomX: number[];
  bottomY: number;
  bottomW: number;
  /** 上层菱形中心 x（槽位 0~3） */
  topX: number[];
  topY: number;
  topW: number;
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
    bottomX: BOTTOM_SLOTS.map((_, i) => left + (i + 0.5) * bottomW),
    bottomY: BOTTOM_Y * h,
    bottomW,
    topX: TOP_SLOTS.map((_, i) => left + (i + 0.5) * topW),
    topY: TOP_Y * h,
    topW,
  };
  geomKey = key;
  geomCache = g;
  return g;
}

function targetOf(g: Geom, slot: Slot): { x: number; y: number; w: number } {
  return slot.row === 0
    ? { x: g.topX[slot.index]!, y: g.topY, w: g.topW }
    : { x: g.bottomX[slot.index]!, y: g.bottomY, w: g.bottomW };
}

/** 沿车道从消失点到判定点的插值（p=0 消失点，p=1 判定点） */
function along(g: Geom, target: { x: number; y: number }, p: number) {
  return { x: g.vx + (target.x - g.vx) * p, y: g.vy + (target.y - g.vy) * p };
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
  sky.addColorStop(0, "#08070f");
  sky.addColorStop(0.45, "#120e26");
  sky.addColorStop(1, "#05060d");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 地平线与远山线框
  ctx.save();
  ctx.strokeStyle = hexToRgba(RAIL, 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, g.vy);
  ctx.lineTo(w, g.vy);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(RAIL, 0.18);
  for (const dir of [-1, 1] as const) {
    ctx.beginPath();
    let x = g.vx + dir * w * 0.1;
    let up = true;
    ctx.moveTo(x, g.vy);
    for (let i = 0; i < 7; i++) {
      const step = w * 0.06;
      x += dir * step;
      ctx.lineTo(x, g.vy - (up ? h * (0.03 + (i % 3) * 0.015) : 0));
      up = !up;
    }
    ctx.stroke();
  }
  ctx.restore();

  // 透视横向网格（向下渐密，随时间流动）
  ctx.save();
  ctx.strokeStyle = hexToRgba(RAIL, 0.1);
  ctx.lineWidth = 1;
  const flow = (now / 2600) % 1;
  for (let i = 0; i < 14; i++) {
    const p = Math.pow((i + flow) / 14, 2.2);
    const y = g.vy + (h - g.vy) * p;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();

  // 5 条车道面 + 分界线
  for (let i = 0; i < BOTTOM_SLOTS.length; i++) {
    const cx = g.bottomX[i]!;
    const l = cx - g.bottomW / 2;
    const r = cx + g.bottomW / 2;
    const grad = ctx.createLinearGradient(0, g.vy, 0, g.bottomY);
    const base = BOTTOM_SLOTS[i] ? hexToRgba(PART_BY_ID[BOTTOM_SLOTS[i]!].color, 0.14) : "rgba(255,255,255,0.05)";
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(1, base);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(g.vx, g.vy);
    ctx.lineTo(l, h);
    ctx.lineTo(r, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.save();
  ctx.strokeStyle = hexToRgba(RAIL, 0.45);
  ctx.lineWidth = 1.2;
  ctx.shadowColor = RAIL;
  ctx.shadowBlur = glow ? 8 : 0;
  for (let i = 0; i <= BOTTOM_SLOTS.length; i++) {
    const x = g.bottomX[0]! - g.bottomW / 2 + i * g.bottomW;
    ctx.beginPath();
    ctx.moveTo(g.vx, g.vy);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.restore();
}

/** 上层判定线：贯穿横线 + 4 个菱形 */
function drawTopRow(
  ctx: CanvasRenderingContext2D,
  g: Geom,
  f: StageFrame,
  glow: boolean,
) {
  const left = g.topX[0]! - g.topW / 2;
  const right = g.topX[TOP_SLOTS.length - 1]! + g.topW / 2;
  ctx.save();
  ctx.strokeStyle = hexToRgba(ACCENT, 0.75);
  ctx.lineWidth = 2;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = glow ? 12 : 0;
  ctx.beginPath();
  ctx.moveTo(left, g.topY);
  ctx.lineTo(right, g.topY);
  ctx.stroke();
  ctx.restore();

  const rx = g.topW * 0.34;
  const ry = rx * 0.62;
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
    ctx.scale(1 + hit * 0.16, 1 + hit * 0.16);
    ctx.beginPath();
    ctx.moveTo(0, -ry);
    ctx.lineTo(rx, 0);
    ctx.lineTo(0, ry);
    ctx.lineTo(-rx, 0);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(color, 0.18 + hit * 0.6);
    ctx.fill();
    ctx.strokeStyle = miss > 0 ? hexToRgba("#f87171", 0.9) : hexToRgba(color, 0.85);
    ctx.lineWidth = 1.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = glow ? 8 + hit * 16 : 0;
    ctx.stroke();
    ctx.restore();
  }
}

/** 下层打击盘：黄色箭头矩形 + 脚印标记 */
function drawBottomRow(
  ctx: CanvasRenderingContext2D,
  g: Geom,
  f: StageFrame,
  glow: boolean,
) {
  const padW = g.bottomW * 0.86;
  const padH = Math.max(18, g.h * 0.058);
  for (let i = 0; i < BOTTOM_SLOTS.length; i++) {
    const part = BOTTOM_SLOTS[i];
    const x = g.bottomX[i]!;
    const color = part ? PART_BY_ID[part].color : "#8b93a7";
    // 开闭镲列的闪光同时响应踩镲踏板
    const expiry = part
      ? Math.max(f.flashes[part] ?? 0, part === "hihat" ? (f.flashes["pedalHat"] ?? 0) : 0)
      : 0;
    const hit = Math.max(0, Math.min(1, (expiry - f.now) / FLASH_MS));
    const missExpiry = part
      ? Math.max(f.missFlashes?.[part] ?? 0, part === "hihat" ? (f.missFlashes?.["pedalHat"] ?? 0) : 0)
      : 0;
    const miss = Math.max(0, Math.min(1, (missExpiry - f.now) / 240));

    ctx.save();
    ctx.translate(x, g.bottomY);
    roundRect(ctx, -padW / 2, -padH / 2, padW, padH, padH * 0.22);
    ctx.fillStyle = part
      ? hexToRgba(color, 0.14 + hit * 0.55)
      : "rgba(255,255,255,0.05)";
    ctx.fill();
    ctx.strokeStyle = miss > 0 ? hexToRgba("#f87171", 0.95) : hexToRgba(ACCENT, part ? 0.85 : 0.35);
    ctx.lineWidth = 2;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = glow ? (part ? 10 + hit * 18 : 4) : 0;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 两侧氖光箭头 >>> <<<
    ctx.strokeStyle = hexToRgba(ACCENT, 0.5 + hit * 0.45);
    ctx.lineWidth = 1.6;
    const aw = padH * 0.2;
    for (let k = 0; k < 3; k++) {
      const off = padW * 0.5 - aw * 1.1 - k * aw * 1.1;
      for (const dir of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(dir * (off - aw * 0.5), -aw);
        ctx.lineTo(dir * (off + aw * 0.5), 0);
        ctx.lineTo(dir * (off - aw * 0.5), aw);
        ctx.stroke();
      }
    }

    // 脚印标记（开闭镲踏板列、底鼓列）
    if (FOOT_SLOTS.has(i)) {
      ctx.fillStyle = hexToRgba(ACCENT, 0.45);
      const fy = padH / 2 + padH * 0.42;
      ctx.beginPath();
      ctx.ellipse(0, fy, padW * 0.08, padH * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, fy - padH * 0.3, padW * 0.055, padH * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ================= 音符 =================

interface Placed {
  part: PartId;
  row: 0 | 1;
  x: number;
  y: number;
  size: number;
  color: string;
  label: string | null;
  timeMs: number;
  /** 长按尾端（无长按时与头部相同） */
  tail: { x: number; y: number; size: number } | null;
}

function placeNotes(g: Geom, f: StageFrame): Placed[] {
  const out: Placed[] = [];
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
    const target = targetOf(g, slot);
    const at = (tt: number) => {
      const p = Math.pow(Math.max(0.02, Math.min(1, tt)), EASE);
      const pt = along(g, target, p);
      return { x: pt.x, y: pt.y, size: target.w * (0.16 + 0.84 * p) };
    };
    const head = at(Math.min(t, 1));
    out.push({
      part,
      row: slot.row,
      x: head.x,
      y: head.y,
      size: head.size,
      color: PART_BY_ID[part].color,
      label: hatLabel(part, n.note),
      timeMs: n.timeMs,
      tail: hold ? at(Math.max(0.02, tTail)) : null,
    });
  }
  // 远 → 近绘制
  out.sort((a, b) => a.y - b.y);
  return out;
}

/** 上下两排同刻音符连线（同一排不连） */
function drawChordLinks(ctx: CanvasRenderingContext2D, placed: Placed[], glow: boolean) {
  const byTime = new Map<number, Placed[]>();
  for (const p of placed) {
    const key = Math.round(p.timeMs);
    (byTime.get(key) ?? byTime.set(key, []).get(key)!).push(p);
  }
  ctx.save();
  ctx.lineWidth = 2;
  for (const group of byTime.values()) {
    if (group.length < 2) continue;
    const tops = group.filter((p) => p.row === 0);
    const bottoms = group.filter((p) => p.row === 1);
    if (!tops.length || !bottoms.length) continue;
    for (const a of tops) {
      for (const b of bottoms) {
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, hexToRgba(a.color, 0.55));
        grad.addColorStop(1, hexToRgba(b.color, 0.55));
        ctx.strokeStyle = grad;
        ctx.shadowColor = hexToRgba(a.color, 0.6);
        ctx.shadowBlur = glow ? 8 : 0;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawNote(ctx: CanvasRenderingContext2D, n: Placed, glow: boolean) {
  ctx.save();
  if (n.tail) {
    ctx.strokeStyle = hexToRgba(n.color, 0.35);
    ctx.lineWidth = Math.max(3, n.size * 0.5);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(n.tail.x, n.tail.y);
    ctx.lineTo(n.x, n.y);
    ctx.stroke();
  }
  ctx.shadowColor = n.color;
  ctx.shadowBlur = glow ? 12 : 0;
  if (n.row === 0) {
    const rx = n.size * 0.42;
    const ry = rx * 0.66;
    ctx.beginPath();
    ctx.moveTo(n.x, n.y - ry);
    ctx.lineTo(n.x + rx, n.y);
    ctx.lineTo(n.x, n.y + ry);
    ctx.lineTo(n.x - rx, n.y);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(n.color, 0.9);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else {
    const nw = n.size * 0.84;
    const nh = Math.max(4, n.size * 0.3);
    roundRect(ctx, n.x - nw / 2, n.y - nh / 2, nw, nh, nh * 0.35);
    ctx.fillStyle = hexToRgba(n.color, 0.92);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (n.label && nh > 9) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(10,10,14,0.92)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(7, Math.round(nh * 0.62))}px system-ui, sans-serif`;
      ctx.fillText(n.label, n.x, n.y + 0.5);
    }
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
  ctx.fillStyle = "#05060d";
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
