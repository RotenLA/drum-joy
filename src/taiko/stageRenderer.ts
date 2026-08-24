/**
 * 舞台下落式渲染器：扇形鼓盘阵 + 顶部收束段辐射车道
 *
 * 纯 Canvas 2D 伪 3D，与 React 解耦。鼓盘摆位/颜色全部来自
 * laneLayouts 的 PAD_ANCHORS / DRUM_PARTS，本文件只负责绘制。
 *
 * 场景：录音棚背景（墙/地分界线对齐顶排鼓身后）+ 顶部聚光灯，
 * 9 条细光车道从顶部「收束段」（宽约一个通鼓，非单点）辐射到各鼓盘，
 * 音符由小变大滑向鼓盘，鼓盘即判定落点，命中时鼓盘增亮回弹并喷火花粒子。
 * 所有部件带地面接触阴影，压扁比统一 = 同一地板视角。
 */
import type { TaikoChart } from "@/shared/taikoChart";
import stageBgUrl from "@/assets/stage-bg.jpg";
import {
  DRUM_PARTS,
  PAD_ANCHORS,
  PART_BY_ID,
  PART_BY_NOTE,
  type PadAnchor,
  type PartId,
} from "./laneLayouts";

/** 背景图墙/地分界线（归一化 y，相对背景图高度） */
const BG_SEAM_Y = 0.638;
/**
 * 分界线在屏幕上的目标位置。
 * 推算：顶排镲（cy=0.66）后缘 y≈0.634，分界线放在其上方 ~0.034 屏高处，
 * 让顶排鼓站在墙根前的地板上，墙根暗色读作鼓的后阴影。
 */
const SEAM_SCREEN_Y = 0.6;

/** 录音棚背景图（浏览器侧懒加载；SSR 无 Image，退回纯色舞台） */
const bgImg = typeof Image !== "undefined" ? new Image() : null;
if (bgImg) bgImg.src = stageBgUrl;

/**
 * 车道收束段（顶部中央）：y 归一化，半宽 0.05 → 总宽 0.10w，
 * ≈ 高通/中通鼓面宽度（2×0.048w），避免所有车道挤成一个点。
 */
const GATE = { y: 0.13, halfW: 0.05 } as const;
/** 鼓盘 cx 的分布半径（0.84-0.5），用于把车道起点映射进收束段 */
const PAD_SPREAD = 0.34;
/** 音符从收束段飞到鼓盘的时间（1x 速度下，毫秒） */
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
  // 同一地板视角：鼓面与平放的踏板共享压扁比 0.42；
  // 镲片略平（0.3）表现微微倾向演奏者的倾角。
  const ratio = a.kind === "cymbal" ? 0.3 : 0.42;
  return { cx: a.cx * w, cy: a.cy * h, rx, ry: rx * ratio };
}

/** 车道起点（收束段内）：按鼓盘 cx 等比映射，保持左右顺序不交叉 */
function gatePoint(padCx: number, w: number, h: number) {
  const x = (0.5 + (padCx - 0.5) * (GATE.halfW / PAD_SPREAD)) * w;
  return { x, y: GATE.y * h };
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, w, h);

  // 录音棚背景：墙/地分界线对齐到 SEAM_SCREEN_Y（顶排鼓身后墙根）
  if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
    const iw = bgImg.naturalWidth;
    const ih = bgImg.naturalHeight;
    let s = (SEAM_SCREEN_Y * h) / (BG_SEAM_Y * ih);
    if (iw * s < w) s = w / iw; // 横向铺满优先
    if (ih * s < h) s = h / ih; // 纵向铺满兜底
    let dy = SEAM_SCREEN_Y * h - BG_SEAM_Y * ih * s;
    dy = Math.min(0, Math.max(h - ih * s, dy));
    const dx = (w - iw * s) / 2;
    ctx.drawImage(bgImg, dx, dy, iw * s, ih * s);
    // 轻微压暗，突出鼓盘与音符
    ctx.fillStyle = "rgba(6,6,8,0.35)";
    ctx.fillRect(0, 0, w, h);
  }

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
  ctx.save();
  ctx.lineWidth = 1.5;
  for (const part of DRUM_PARTS) {
    const anchor = PAD_ANCHORS[part.id];
    const p = padPixels(anchor, w, h);
    const g0 = gatePoint(anchor.cx, w, h);
    const g = ctx.createLinearGradient(g0.x, g0.y, p.cx, p.cy);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(255,255,255,0.2)");
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(g0.x, g0.y);
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
  const visible: { part: PartId; t: number; big: boolean }[] = [];
  for (const n of f.chart.notes) {
    if (n.note === undefined) continue;
    const part = PART_BY_NOTE[n.note];
    if (!part) continue;
    // t: 0 = 收束段，1 = 鼓盘（到达即命中，不再绘制）
    const t = 1 - ((n.timeMs - f.timeMs) * f.speed) / LEAD_MS;
    if (t <= 0.02 || t >= 1) continue;
    visible.push({ part, t, big: !!n.big });
  }
  // 远的先画，近的在上一层
  visible.sort((a, b) => a.t - b.t);

  for (const { part, t, big } of visible) {
    const anchor = PAD_ANCHORS[part];
    const pad = padPixels(anchor, w, h);
    const g0 = gatePoint(anchor.cx, w, h);
    const p = Math.pow(t, EASE);
    const x = g0.x + (pad.cx - g0.x) * p;
    const y = g0.y + (pad.cy - g0.y) * p;
    const scale = (0.18 + 0.82 * p) * (big ? 1.35 : 1);
    const nw = Math.max(6, pad.rx * 0.8 * scale);
    const nh = Math.max(3, nw * 0.34);
    // 芯片长边垂直于车道方向
    const ang = Math.atan2(pad.cy - g0.y, pad.cx - g0.x) + Math.PI / 2;
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

/** 地面接触阴影：把部件「钉」在地板上，统一视角的关键 */
function drawContactShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.85, rx * 1.12, ry * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 方形踏板鼓盘（底鼓/踩镲踏板）：低趴圆角矩形踏板 + 薄侧沿 */
function drawSquarePad(
  ctx: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  intensity: number,
) {
  const s = 1 + 0.1 * intensity; // 命中回弹
  const RX = rx * s;
  const RY = ry * s;
  const rr = Math.min(RY * 0.4, 8);

  ctx.save();
  ctx.translate(cx, cy);

  // 薄侧沿（低趴楔块，不再像立起来的盒子）
  const depth = RY * 0.45;
  const side = ctx.createLinearGradient(0, 0, 0, depth + RY);
  side.addColorStop(0, "#1e1e24");
  side.addColorStop(1, "#0a0a0d");
  ctx.beginPath();
  ctx.roundRect(-RX, -RY + depth, RX * 2, RY * 2, rr);
  ctx.fillStyle = side;
  ctx.fill();
  ctx.strokeStyle = hexToRgba(color, 0.25 + 0.5 * intensity);
  ctx.lineWidth = 1;
  ctx.stroke();

  // 面板：深灰金属 + 部件色淡染
  const face = ctx.createRadialGradient(0, -RY * 0.4, RY * 0.2, 0, 0, RX);
  face.addColorStop(0, "#28282f");
  face.addColorStop(1, "#131316");
  ctx.beginPath();
  ctx.roundRect(-RX, -RY, RX * 2, RY * 2, rr);
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
  ctx.roundRect(-RX, -RY, RX * 2, RY * 2, rr);
  ctx.stroke();

  // 命中白闪
  if (intensity > 0) {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,255,255,${0.7 * intensity})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-RX - 3, -RY - 3, RX * 2 + 6, RY * 2 + 6, rr + 3);
    ctx.stroke();
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

  // 接触阴影不随命中回弹缩放
  drawContactShadow(ctx, p.cx, p.cy, p.rx, p.ry);

  if (anchor.square) {
    drawSquarePad(ctx, color, p.cx, p.cy, p.rx, p.ry, intensity);
    return;
  }

  const s = 1 + 0.1 * intensity; // 命中回弹
  const RX = p.rx * s;
  const RY = p.ry * s;
  const isCymbal = anchor.kind === "cymbal";

  ctx.save();
  ctx.translate(p.cx, p.cy);

  if (isCymbal) {
    // 镲片边缘厚度：下方露出的暗色边带
    ctx.beginPath();
    ctx.ellipse(0, RY * 0.22, RX, RY, 0, 0, Math.PI);
    ctx.lineTo(-RX, 0);
    ctx.closePath();
    ctx.fillStyle = "#0e0e11";
    ctx.fill();
    ctx.strokeStyle = hexToRgba(color, 0.2 + 0.4 * intensity);
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    // 鼓腔侧面：强纵向明暗 + 部件色淡染
    const depth = RY * 0.9;
    const side = ctx.createLinearGradient(0, 0, 0, depth + RY);
    side.addColorStop(0, "#232329");
    side.addColorStop(1, "#0a0a0d");
    ctx.beginPath();
    ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI);
    ctx.lineTo(-RX, depth);
    ctx.ellipse(0, depth, RX, RY, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fillStyle = side;
    ctx.fill();
    ctx.fillStyle = hexToRgba(color, 0.07 + 0.16 * intensity);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(color, 0.25 + 0.5 * intensity);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 盘面：方向性顶光（左上方来光），镲片比鼓更亮一档
  const face = isCymbal
    ? ctx.createRadialGradient(-RX * 0.28, -RY * 0.4, RY * 0.15, 0, 0, RX * 1.05)
    : ctx.createRadialGradient(0, -RY * 0.45, RY * 0.2, 0, 0, RX);
  if (isCymbal) {
    face.addColorStop(0, "#3d3d47");
    face.addColorStop(0.55, "#232328");
    face.addColorStop(1, "#111114");
  } else {
    face.addColorStop(0, "#2b2b32");
    face.addColorStop(1, "#121215");
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.fillStyle = hexToRgba(color, 0.1 + 0.28 * intensity);
  ctx.fill();

  if (isCymbal) {
    // 车纹：亮纹 + 紧邻暗纹
    for (const g of [0.45, 0.62, 0.8]) {
      ctx.beginPath();
      ctx.ellipse(0, 0, RX * g, RY * g, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, RX * (g + 0.045), RY * (g + 0.045), 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.stroke();
    }
  } else {
    // 鼓圈（rim）高光：鼓皮内沿一圈亮色金属环
    ctx.beginPath();
    ctx.ellipse(0, 0, RX * 0.9, RY * 0.9, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, RX * 0.9, RY * 0.9, 0, Math.PI * 1.15, Math.PI * 1.85);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.stroke();
  }

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

  if (isCymbal) {
    // Bell 中心拱起：径向渐变圆顶 + 高光点
    ctx.shadowBlur = 0;
    const bell = ctx.createRadialGradient(
      -RX * 0.05,
      -RY * 0.08,
      RY * 0.05,
      0,
      0,
      RX * 0.24,
    );
    bell.addColorStop(0, "#4c4c57");
    bell.addColorStop(0.6, "#26262c");
    bell.addColorStop(1, "#131316");
    ctx.beginPath();
    ctx.ellipse(0, 0, RX * 0.24, RY * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = bell;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-RX * 0.07, -RY * 0.09, RX * 0.05, RY * 0.05, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
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

  // 连击（左上角，分数下方，大号斜体）
  if (f.combo > 0) {
    const size = Math.round(h * 0.062);
    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(255,255,255,0.4)";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#ffffff";
    ctx.font = `italic 900 ${size}px system-ui, sans-serif`;
    ctx.fillText(String(f.combo), 28, 58 + size + 10);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "700 10px system-ui, sans-serif";
    ctx.fillText("C O M B O", 28, 58 + size + 28);
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
