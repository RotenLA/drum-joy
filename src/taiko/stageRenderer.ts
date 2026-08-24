/**
 * 舞台下落式渲染器：扇形鼓盘阵 + 顶部消失点辐射车道
 *
 * 纯 Canvas 2D 伪 3D，与 React 解耦。鼓盘摆位/颜色全部来自
 * laneLayouts 的 PAD_ANCHORS / DRUM_PARTS，本文件只负责绘制。
 *
 * 场景：深灰黑舞台 + 顶部聚光灯，9 条细光车道从顶部中央消失点
 * 辐射到各鼓盘，音符由小变大滑向鼓盘，鼓盘即判定落点，
 * 命中时鼓盘增亮回弹并喷火花粒子。
 */
import type { TaikoChart } from "@/shared/taikoChart";
import {
  DRUM_PARTS,
  PAD_ANCHORS,
  PART_BY_ID,
  PART_BY_NOTE,
  type PadAnchor,
  type PartId,
} from "./laneLayouts";

/** 消失点（顶部中央，归一化坐标） */
const VP = { x: 0.5, y: 0.13 } as const;
/** 音符从消失点飞到鼓盘的时间（1x 速度下，毫秒） */
const LEAD_MS = 2400;
/** 透视加速指数：>1 让音符近大远小的同时近处加速 */
const EASE = 1.55;
/** 命中闪光时长（与 FallScreen 的 FLASH_MS 对应） */
const FLASH_MS = 200;

export interface StageFrame {
  chart: TaikoChart;
  timeMs: number;
  speed: number;
  /** performance.now()，驱动动画与粒子 */
  now: number;
  /** partId -> 闪光截止时间戳（performance.now() 基准） */
  flashes: Record<string, number>;
  combo: number;
  score: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: string;
}

/** 模块级粒子池与闪光去重表（rAF 逐帧驱动，无额外状态库） */
const particles: Particle[] = [];
const lastFlash: Partial<Record<PartId, number>> = {};

function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** 鼓盘锚点 → 像素几何 */
function padPixels(a: PadAnchor, w: number, h: number) {
  const rx = a.r * w;
  const ratio = a.kind === "drum" ? 0.42 : a.kind === "cymbal" ? 0.3 : 0.28;
  return { cx: a.cx * w, cy: a.cy * h, rx, ry: rx * ratio };
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, w, h);
  // 顶部聚光灯
  const spot = ctx.createRadialGradient(
    w * 0.5,
    h * 0.18,
    0,
    w * 0.5,
    h * 0.18,
    h * 0.8,
  );
  spot.addColorStop(0, "rgba(80,110,255,0.12)");
  spot.addColorStop(1, "rgba(80,110,255,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, w, h);
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, h * 0.72, 0, h);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
}

function drawLanes(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const vpX = VP.x * w;
  const vpY = VP.y * h;
  ctx.save();
  ctx.lineWidth = 1.5;
  for (const part of DRUM_PARTS) {
    const p = padPixels(PAD_ANCHORS[part.id], w, h);
    const g = ctx.createLinearGradient(vpX, vpY, p.cx, p.cy);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(255,255,255,0.2)");
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(vpX, vpY);
    ctx.lineTo(p.cx, p.cy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNotes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  f: StageFrame,
) {
  const vpX = VP.x * w;
  const vpY = VP.y * h;

  const visible: { part: PartId; t: number; big: boolean }[] = [];
  for (const n of f.chart.notes) {
    if (n.note === undefined) continue;
    const part = PART_BY_NOTE[n.note];
    if (!part) continue;
    // t: 0 = 消失点，1 = 鼓盘（到达即命中，不再绘制）
    const t = 1 - ((n.timeMs - f.timeMs) * f.speed) / LEAD_MS;
    if (t <= 0.02 || t >= 1) continue;
    visible.push({ part, t, big: !!n.big });
  }
  // 远的先画，近的在上一层
  visible.sort((a, b) => a.t - b.t);

  for (const { part, t, big } of visible) {
    const anchor = PAD_ANCHORS[part];
    const pad = padPixels(anchor, w, h);
    const p = Math.pow(t, EASE);
    const x = vpX + (pad.cx - vpX) * p;
    const y = vpY + (pad.cy - vpY) * p;
    const scale = (0.18 + 0.82 * p) * (big ? 1.35 : 1);
    const nw = Math.max(6, pad.rx * 0.8 * scale);
    const nh = Math.max(3, nw * 0.34);
    // 芯片长边垂直于车道方向
    const ang = Math.atan2(pad.cy - vpY, pad.cx - vpX) + Math.PI / 2;
    const color = PART_BY_ID[part].color;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.globalAlpha = 0.25 + 0.75 * p;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16 * scale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-nw / 2, -nh / 2, nw, nh, nh / 2);
    ctx.fill();
    // 顶部高光
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.roundRect(-nw / 2, -nh / 2, nw, nh * 0.32, nh / 4);
    ctx.fill();
    ctx.restore();
  }
}

function spawnSparks(anchor: PadAnchor, color: string, w: number, h: number, now: number) {
  const p = padPixels(anchor, w, h);
  const k = h / 650;
  for (let i = 0; i < 12; i++) {
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const sp = (0.06 + Math.random() * 0.12) * k;
    particles.push({
      x: p.cx + (Math.random() - 0.5) * p.rx * 1.2,
      y: p.cy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      born: now,
      life: 320 + Math.random() * 220,
      color,
    });
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, now: number) {
  ctx.save();
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i]!;
    const age = now - pt.born;
    if (age >= pt.life) {
      particles.splice(i, 1);
      continue;
    }
    const x = pt.x + pt.vx * age;
    const y = pt.y + pt.vy * age + 0.0004 * age * age; // 轻微下坠
    const a = 1 - age / pt.life;
    ctx.globalAlpha = a;
    ctx.shadowColor = pt.color;
    ctx.shadowBlur = 6;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPad(
  ctx: CanvasRenderingContext2D,
  partId: PartId,
  intensity: number,
  w: number,
  h: number,
) {
  const anchor = PAD_ANCHORS[partId];
  const color = PART_BY_ID[partId].color;
  const p = padPixels(anchor, w, h);
  const s = 1 + 0.1 * intensity; // 命中回弹
  const RX = p.rx * s;
  const RY = p.ry * s;

  ctx.save();
  ctx.translate(p.cx, p.cy);

  // 鼓腔侧面（仅 drum 有厚度）
  if (anchor.kind === "drum") {
    const depth = RY * 0.9;
    const side = ctx.createLinearGradient(0, 0, 0, depth + RY);
    side.addColorStop(0, "#1d1d22");
    side.addColorStop(1, "#0d0d10");
    ctx.beginPath();
    ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI);
    ctx.lineTo(-RX, depth);
    ctx.ellipse(0, depth, RX, RY, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fillStyle = side;
    ctx.fill();
    ctx.strokeStyle = hexToRgba(color, 0.25 + 0.5 * intensity);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 盘面：深灰金属 + 部件色淡染
  const face = ctx.createRadialGradient(0, -RY * 0.4, RY * 0.2, 0, 0, RX);
  face.addColorStop(0, anchor.kind === "cymbal" ? "#2e2e34" : "#26262c");
  face.addColorStop(1, "#131316");
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.fillStyle = hexToRgba(color, 0.1 + 0.28 * intensity);
  ctx.fill();

  // 描边 + 泛光（命中时增亮）
  ctx.shadowColor = color;
  ctx.shadowBlur = 12 + 26 * intensity;
  ctx.strokeStyle = hexToRgba(color, 0.85);
  ctx.lineWidth = 2.5 + 2.5 * intensity;
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 命中白闪
  if (intensity > 0) {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,255,255,${0.7 * intensity})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, RX + 3, RY + 3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 镲片中心帽
  if (anchor.kind === "cymbal") {
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#1a1a1e";
    ctx.beginPath();
    ctx.ellipse(0, 0, RX * 0.16, RY * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, f: StageFrame) {
  ctx.save();

  // 顶部细进度条
  const progress = f.chart.durationMs > 0 ? f.timeMs / f.chart.durationMs : 0;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, 0, w, 3);
  ctx.shadowColor = "#5D8CF4";
  ctx.shadowBlur = 8;
  ctx.fillStyle = "#5D8CF4";
  ctx.fillRect(0, 0, w * Math.min(1, progress), 3);
  ctx.shadowBlur = 0;

  // 左上得分
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "600 10px system-ui, sans-serif";
  ctx.fillText("S C O R E", 28, 30);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 26px system-ui, sans-serif";
  ctx.shadowColor = "rgba(255,255,255,0.3)";
  ctx.shadowBlur = 10;
  ctx.fillText(String(f.score).padStart(7, "0"), 28, 58);
  ctx.shadowBlur = 0;

  // 右上曲名 + BPM
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 15px system-ui, sans-serif";
  ctx.fillText(f.chart.title, w - 28, 32);
  ctx.fillStyle = "#5D8CF4";
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillText(`BPM ${f.chart.bpm}`, w - 28, 50);

  // 连击（中上方悬浮，大号斜体）
  if (f.combo > 0) {
    const size = Math.round(h * 0.085);
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(255,255,255,0.4)";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "#ffffff";
    ctx.font = `italic 900 ${size}px system-ui, sans-serif`;
    ctx.fillText(String(f.combo), w * 0.5, h * 0.3);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.fillText("C O M B O", w * 0.5, h * 0.3 + 18);
  }

  ctx.restore();
}

export function renderStage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  f: StageFrame,
) {
  drawBackground(ctx, w, h);
  drawLanes(ctx, w, h);
  drawNotes(ctx, w, h, f);

  // 远的鼓盘先画，近的压上层（无遮挡摆位下主要是保险）
  const parts = [...DRUM_PARTS].sort(
    (a, b) => PAD_ANCHORS[a.id].cy - PAD_ANCHORS[b.id].cy,
  );
  for (const part of parts) {
    const expiry = f.flashes[part.id] ?? 0;
    const intensity = Math.max(0, Math.min(1, (expiry - f.now) / FLASH_MS));
    if (expiry > (lastFlash[part.id] ?? 0)) {
      spawnSparks(PAD_ANCHORS[part.id], part.color, w, h, f.now);
      lastFlash[part.id] = expiry;
    }
    drawPad(ctx, part.id, intensity, w, h);
  }

  drawParticles(ctx, f.now);
  drawVignette(ctx, w, h);
  drawHud(ctx, w, h, f);
}
