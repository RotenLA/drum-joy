/**
 * 舞台下落式渲染器：扇形鼓盘阵 + 顶部收束段辐射车道
 *
 * 纯 Canvas 2D 伪 3D，与 React 解耦。鼓盘摆位/颜色全部来自
 * laneLayouts 的 PAD_ANCHORS / DRUM_PARTS，本文件只负责绘制。
 *
 * 场景：专辑封面全幅铺底（压灰压暗 + 全屏纵向遮罩），无地板/倒影/接触阴影，
 * 9 条细光车道按「三排独立收束段」辐射到各排鼓盘（宽约一个通鼓，非单点），
 * 音符由小变大滑向鼓盘，鼓盘即判定落点，命中时鼓盘增亮回弹并喷火花粒子。
 * 踏板为斜放的立方体（顶面旋转后按 0.42 均匀压扁，与鼓面椭圆同一压扁比）。
 */
import type { TaikoChart } from "@/shared/taikoChart";
import stageWallUrl from "@/assets/stage-wall.jpg";
import {
  DRUM_PARTS,
  PAD_ANCHORS,
  PART_BY_ID,
  PART_BY_NOTE,
  type PadAnchor,
  type PartId,
} from "./laneLayouts";

/** 专辑封面背景（浏览器侧懒加载；SSR 无 Image，退回纯色背景） */
const wallImg = typeof Image !== "undefined" ? new Image() : null;
if (wallImg) wallImg.src = stageWallUrl;

/**
 * 车道收束段：三排（上/中/下）各自独立，横向半宽 0.05 → 总宽 0.10w
 * ≈ 高通/中通鼓面宽度（2×0.048w）。分层后各排车道在屏幕上按高度分开，
 * 不再长距离重叠；同列部件（高通↔踩镲踏板、中通↔底鼓）的车道接近平行。
 */
const ROW_GATES = [
  { y: 0.13, halfW: 0.05 },
  { y: 0.3, halfW: 0.05 },
  { y: 0.46, halfW: 0.05 },
] as const;
/** 鼓盘 cx 的分布半径（0.84-0.5），用于把车道起点映射进收束段 */
const PAD_SPREAD = 0.34;
/** 音符从收束段飞到鼓盘的时间（1x 速度下，毫秒） */
const LEAD_MS = 2400;
/** 透视加速指数：>1 让音符近大远小的同时近处加速 */
const EASE = 1.55;
/** 命中闪光时长（与 FallScreen 的 FLASH_MS 对应） */
const FLASH_MS = 200;
/** 踏板斜放角：左右镜像「外八」，顶面正方形旋转后再按 0.42 压扁 */
const PEDAL_TILT = (12 * Math.PI) / 180;

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
  // 同一地板视角：鼓面与平放的踏板共享压扁比 0.42
  return { cx: a.cx * w, cy: a.cy * h, rx, ry: rx * 0.42 };
}


/** 车道起点（本排收束段内）：按鼓盘 cx 等比映射，保持左右顺序不交叉 */
function gatePoint(anchor: PadAnchor, w: number, h: number) {
  const g = ROW_GATES[anchor.row];
  const x = (0.5 + (anchor.cx - 0.5) * (g.halfW / PAD_SPREAD)) * w;
  return { x, y: g.y * h };
}

/**
 * 鼓盘随车道旋转角（相对垂直方向的偏角）：长轴垂直于车道，与飞来音符同向，
 * 扇形鼓阵「面向消失点」。中间列 ≈0°，最外侧（吊镲/叮叮镲）约 ±41°，左右镜像对称。
 * 踏板不适用（保持外八斜放）。
 */
function padRotation(anchor: PadAnchor, w: number, h: number): number {
  const g = gatePoint(anchor, w, h);
  return Math.atan2(anchor.cy * h - g.y, anchor.cx * w - g.x) - Math.PI / 2;
}

/** 踏板音符倾角：与踏板顶面 x 轴棱线平行（符号与各自踏板的镜像外八一致） */
function pedalNoteAngle(part: PartId): number {
  const th = part === "kick" ? -PEDAL_TILT : PEDAL_TILT;
  return Math.atan2(Math.sin(th) * 0.42, Math.cos(th));
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, w, h);

  if (wallImg && wallImg.complete && wallImg.naturalWidth > 0) {
    const iw = wallImg.naturalWidth;
    const ih = wallImg.naturalHeight;
    // 专辑封面全幅铺底：cover 铺满整个画布，居中裁剪
    const s = Math.max(w / iw, h / ih);
    const dw = iw * s;
    const dh = ih * s;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;

    // 压灰压暗（「灰一点点」）
    ctx.filter = "saturate(0.55) brightness(0.65)";
    ctx.drawImage(wallImg, dx, dy, dw, dh);
    ctx.filter = "none";
    // 全屏纵向遮罩：顶部压暗保 HUD/车道可读，中段最浅展示封面，底部略压暗衬托鼓盘泛光
    const veil = ctx.createLinearGradient(0, 0, 0, h);
    veil.addColorStop(0, "rgba(6,6,8,0.55)");
    veil.addColorStop(0.45, "rgba(6,6,8,0.18)");
    veil.addColorStop(1, "rgba(6,6,8,0.4)");
    ctx.fillStyle = veil;
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
    const g0 = gatePoint(anchor, w, h);
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
    const g0 = gatePoint(anchor, w, h);
    const p = Math.pow(t, EASE);
    const x = g0.x + (pad.cx - g0.x) * p;
    const y = g0.y + (pad.cy - g0.y) * p;
    const scale = (0.18 + 0.82 * p) * (big ? 1.35 : 1);
    const nw = Math.max(6, pad.rx * 0.8 * scale);
    const nh = Math.max(3, nw * 0.34);
    // 芯片长边垂直于车道方向；踏板音符与踏板顶面棱线平行（踏板不随车道旋转）
    const ang = anchor.square
      ? pedalNoteAngle(part)
      : Math.atan2(pad.cy - g0.y, pad.cx - g0.x) + Math.PI / 2;
    const color = PART_BY_ID[part].color;
    // 出生淡入：中/下排收束段在屏幕中段，避免音符凭空冒出
    const fadeIn = Math.min(1, t / 0.1);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.globalAlpha = (0.25 + 0.75 * p) * fadeIn;
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

/**
 * 方形踏板鼓盘（底鼓/踩镲踏板）：斜放的立方体。
 * 顶面 = 旋转 ±PEDAL_TILT 的正方形按 0.42 均匀压扁（与鼓同一仿射地板，
 * 无透视收窄）；左右踏板镜像「外八」。侧面只画朝向玩家的可见面。
 */
function drawSquarePad(
  ctx: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  intensity: number,
  mirror: boolean,
) {
  const s = 1 + 0.1 * intensity; // 命中回弹
  const RX = rx * s;
  const RY = ry * s;
  const th = mirror ? -PEDAL_TILT : PEDAL_TILT;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const depth = RY * 1.0; // 盒体厚度

  // 顶面四角：地板坐标（未压扁的正方形）先旋转，再按 0.42 压扁 —— 与鼓面椭圆同一投影规则
  const corner = (sx: number, sy: number) => {
    const fx = sx * RX;
    const fy = sy * RX;
    return { x: fx * cos - fy * sin, y: (fx * sin + fy * cos) * 0.42 };
  };
  const top = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const bot = top.map((p) => ({ x: p.x, y: p.y + depth }));

  const topPath = () => {
    ctx.beginPath();
    ctx.moveTo(top[0]!.x, top[0]!.y);
    for (let i = 1; i < 4; i++) ctx.lineTo(top[i]!.x, top[i]!.y);
    ctx.closePath();
  };

  // 可见侧面：外法线朝下（朝向玩家）的顶面边
  const visibleEdges: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const a = top[i]!;
    const b = top[j]!;
    let nx = b.y - a.y;
    let ny = -(b.x - a.x);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (nx * mx + ny * my < 0) {
      nx = -nx;
      ny = -ny;
    }
    if (ny > 0) visibleEdges.push([i, j]);
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = "round";

  // 侧面：上暗下更暗的纵向渐变 + 部件色淡染
  for (const [i, j] of visibleEdges) {
    const a = top[i]!;
    const b = top[j]!;
    const my = (a.y + b.y) / 2;
    const side = ctx.createLinearGradient(0, my, 0, my + depth);
    side.addColorStop(0, "#1e1e24");
    side.addColorStop(1, "#0a0a0d");
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(bot[j]!.x, bot[j]!.y);
    ctx.lineTo(bot[i]!.x, bot[i]!.y);
    ctx.closePath();
    ctx.fillStyle = side;
    ctx.fill();
    ctx.fillStyle = hexToRgba(color, 0.06 + 0.14 * intensity);
    ctx.fill();
  }

  // 顶面：后暗前亮（与鼓的方向性顶光一致）+ 部件色淡染
  const ys = top.map((p) => p.y);
  const face = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
  face.addColorStop(0, "#17171b");
  face.addColorStop(1, "#2b2b33");
  topPath();
  ctx.fillStyle = face;
  ctx.fill();
  ctx.fillStyle = hexToRgba(color, 0.1 + 0.28 * intensity);
  ctx.fill();

  // 底沿金属亮边（可见侧面的下缘）
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1.5;
  for (const [i, j] of visibleEdges) {
    ctx.beginPath();
    ctx.moveTo(bot[i]!.x, bot[i]!.y);
    ctx.lineTo(bot[j]!.x, bot[j]!.y);
    ctx.stroke();
  }

  // 描边 + 泛光（命中时增亮）
  ctx.shadowColor = color;
  ctx.shadowBlur = 12 + 26 * intensity;
  ctx.strokeStyle = hexToRgba(color, 0.85);
  ctx.lineWidth = 2.5 + 2.5 * intensity;
  topPath();
  ctx.stroke();

  // 命中白闪（外扩一圈）
  if (intensity > 0) {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,255,255,${0.7 * intensity})`;
    ctx.lineWidth = 1.5;
    ctx.save();
    ctx.scale(1.06, 1.06);
    topPath();
    ctx.stroke();
    ctx.restore();
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

  if (anchor.square) {
    // 左右踏板镜像「外八」斜放
    drawSquarePad(ctx, color, p.cx, p.cy, p.rx, p.ry, intensity, partId === "kick");
    return;
  }

  const s = 1 + 0.1 * intensity; // 命中回弹
  const RX = p.rx * s;
  const RY = p.ry * s;
  ctx.save();
  ctx.translate(p.cx, p.cy);
  // 鼓盘整体随车道旋转：鼓腔/盘面/描边/命中闪一起转，等效鼓面朝向来球方向倾斜
  ctx.rotate(padRotation(anchor, w, h));

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

  // 盘面：方向性顶光（上方来光）
  const face = ctx.createRadialGradient(0, -RY * 0.45, RY * 0.2, 0, 0, RX);
  face.addColorStop(0, "#2b2b32");
  face.addColorStop(1, "#121215");
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.fillStyle = hexToRgba(color, 0.1 + 0.28 * intensity);
  ctx.fill();

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
