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
  partOfNote,
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
  { halfW: 0.044 },
  { halfW: 0.044 },
  { halfW: 0.044 },
] as const;

/**
 * 统一等高时间线：每个部件的车道出发点固定在「自己鼓盘正上方 TRAVEL_H 屏高」处，
 * 而不是三条固定高度的横线。这样同一时刻的所有音符离各自鼓盘的距离与缩放完全一致，
 * 消除「同刻多部件看起来有先后」的错觉。
 */
const TRAVEL_H = 0.44;
/** 同刻判定容差（毫秒）：组内音符画同刻连线 */
const CHORD_TOL_MS = 15;

/** 鼓盘 cx 的分布半径（0.84-0.5），用于把车道起点映射进收束段 */
const PAD_SPREAD = 0.34;
/** 音符从收束段飞到鼓盘的时间（1x 速度下，毫秒） */
const LEAD_MS = 2400;
/** 透视加速指数：>1 让音符近大远小的同时近处加速 */
const EASE = 1.55;
/** 命中闪光时长（与 FallScreen 的 FLASH_MS 对应） */
const FLASH_MS = 200;
/** 踏板斜放角：左右镜像「外八」，顶面正方形旋转后再按 0.42 压扁 */
export const PEDAL_TILT = (12 * Math.PI) / 180;

export interface StageFrame {
  chart: TaikoChart;
  timeMs: number;
  speed: number;
  /** performance.now()，驱动动画与粒子 */
  now: number;
  /** partId -> 命中闪光截止时间戳（performance.now() 基准） */
  flashes: Record<string, number>;
  /** partId -> Miss 暗闪截止时间戳 */
  missFlashes?: Record<string, number>;
  combo: number;
  score: number;
  /** 参与渲染的鼓盘（默认全部 9 件；5 分区模式只传 5 件） */
  parts?: readonly PartId[];
  /** 判定浮字（Perfect/Good/Miss），until 后消失 */
  judgement?: { text: string; color: string; until: number } | null;
  /** 倒计时大号数字（4/3/2/1），null 不显示 */
  countText?: string | null;
  /** 判定统计（HUD 显示 P/G/M 与准确率） */
  stats?: { perfect: number; good: number; miss: number } | null;
  /** 生存模式血量 0~1（其他模式不传） */
  hp?: number | null;

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

export function hexToRgba(hex: string, a: number): string {
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


/**
 * 车道起点：横向按鼓盘 cx 等比映射进本排收束段（保持左右顺序不交叉），
 * 纵向统一取「鼓盘上方 TRAVEL_H」，让所有车道行程等高。
 */
function gatePoint(anchor: PadAnchor, w: number, h: number) {
  const g = ROW_GATES[anchor.row]!;
  const x = (0.5 + (anchor.cx - 0.5) * (g.halfW / PAD_SPREAD)) * w;
  return { x, y: (anchor.cy - TRAVEL_H) * h };
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


export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
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

export function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, h * 0.72, 0, h);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
}

function drawLanes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  parts: readonly PartId[],
) {
  ctx.save();
  ctx.lineWidth = 1.5;
  for (const id of parts) {
    const anchor = PAD_ANCHORS[id];
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

export interface DepthItem {
  /** 归一化纵深（0 远 → 1 近），越大越靠近玩家、越后绘制 */
  depth: number;
  draw: () => void;
}

/**
 * 飞行中的音符 → 纵深绘制项。
 * 音符按当前所在高度参与统一排序：飞过某个鼓盘所在深度之前会被该鼓面遮挡，
 * 越过之后才压在上层；到达自己鼓盘时（同深度 + 微小偏置）始终可见。
 */
function noteItems(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  f: StageFrame,
): DepthItem[] {
  const items: DepthItem[] = [];
  // 同刻连线：按时间分桶收集飞行中音符的屏幕位置
  const chords = new Map<number, { x: number; y: number; color: string; p: number }[]>();
  for (const n of f.chart.notes) {
    if (n.note === undefined) continue;
    const part = partOfNote(n.note);
    if (!part) continue;
    const hold = n.holdMs && n.holdMs > 0 ? n.holdMs : 0;
    // t: 0 = 收束段，1 = 鼓盘（到达即命中，不再绘制）
    const t = 1 - ((n.timeMs - f.timeMs) * f.speed) / LEAD_MS;
    const tTail = hold ? 1 - ((n.timeMs + hold - f.timeMs) * f.speed) / LEAD_MS : t;
    if (t <= 0.02) continue;
    if (tTail >= 1) continue;

    const anchor = PAD_ANCHORS[part];
    const pad = padPixels(anchor, w, h);
    const g0 = gatePoint(anchor, w, h);
    const at = (tt: number) => {
      const p = Math.pow(Math.max(0.02, Math.min(1, tt)), EASE);
      return {
        p,
        x: g0.x + (pad.cx - g0.x) * p,
        y: g0.y + (pad.cy - g0.y) * p,
        // 落到鼓面时 = 鼓面的 70%；远端约 13%，重击额外放大
        rx: Math.max(3, pad.rx * (0.18 + 0.82 * p) * 0.7 * (n.big ? 1.3 : 1)),
      };
    };
    const head = at(Math.min(t, 1));
    const tail = hold ? at(tTail) : head;
    const p = head.p;
    const scale = head.rx / Math.max(1, pad.rx);
    const rx = head.rx;
    const { x, y } = head;
    const color = PART_BY_ID[part].color;
    const fadeIn = Math.min(1, t / 0.1);
    const alpha = (0.35 + 0.65 * p) * fadeIn;
    const headVisible = t < 1;


    items.push({
      // 同深度时音符压在鼓盘上层（+ε），保证判定点处不被自己的鼓面吃掉
      depth: y / h + 0.0015,
      draw: () => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = color;

        // 长音符：先画一条从尾端连到头部的色带（左踏板「一直踩住」）
        if (hold) {
          const dx = head.x - tail.x;
          const dy = head.y - tail.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const wh = head.rx * 0.55;
          const wt = tail.rx * 0.55;
          ctx.shadowBlur = 14 * scale;
          ctx.fillStyle = hexToRgba(color, 0.28);
          ctx.strokeStyle = hexToRgba(color, 0.75);
          ctx.lineWidth = Math.max(1, rx * 0.08);
          ctx.beginPath();
          ctx.moveTo(tail.x + nx * wt, tail.y + ny * wt);
          ctx.lineTo(head.x + nx * wh, head.y + ny * wh);
          ctx.lineTo(head.x - nx * wh, head.y - ny * wh);
          ctx.lineTo(tail.x - nx * wt, tail.y - ny * wt);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        if (headVisible) {
          ctx.translate(x, y);
          ctx.shadowBlur = 18 * scale;
          ctx.lineWidth = Math.max(1.4, rx * 0.16);
          ctx.strokeStyle = color;
          ctx.fillStyle = hexToRgba(color, 0.34);

          ctx.beginPath();
          if (anchor.square) {
            // 踏板：与踏板顶面同构——正方形先按外八角旋转，再统一压扁 0.42
            const th = part === "kick" ? -PEDAL_TILT : PEDAL_TILT;
            ctx.save();
            ctx.scale(1, 0.42);
            ctx.rotate(th);
            ctx.roundRect(-rx, -rx, rx * 2, rx * 2, rx * 0.28);
            ctx.restore();
          } else {
            ctx.ellipse(0, 0, rx, rx * 0.42, padRotation(anchor, w, h), 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      },
    });
  }


  return items;
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
  miss = 0,
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

  // Miss 暗闪：顶面压暗 + 红色描边
  if (miss > 0) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(8,8,10,${0.55 * miss})`;
    topPath();
    ctx.fill();
    ctx.strokeStyle = `rgba(248,113,113,${0.65 * miss})`;
    ctx.lineWidth = 2;
    topPath();
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
  miss = 0,
) {
  const anchor = PAD_ANCHORS[partId];
  const color = PART_BY_ID[partId].color;
  const p = padPixels(anchor, w, h);

  if (anchor.square) {
    // 左右踏板镜像「外八」斜放
    drawSquarePad(ctx, color, p.cx, p.cy, p.rx, p.ry, intensity, partId === "kick", miss);
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

  // Miss 暗闪：盘面压暗 + 红色描边
  if (miss > 0) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(8,8,10,${0.55 * miss})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(248,113,113,${0.65 * miss})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();
}

export function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, f: StageFrame) {
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

  // 生存模式血条（进度条下方一条粗条，低血变红闪）
  if (f.hp !== undefined && f.hp !== null) {
    const bw = w * 0.34;
    const bx = (w - bw) / 2;
    const by = 14;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(bx, by, bw, 8);
    const low = f.hp < 0.3;
    const col = low ? "#f87171" : f.hp < 0.6 ? "#fbbf24" : "#4ade80";
    ctx.shadowColor = col;
    ctx.shadowBlur = low ? 14 + 8 * Math.sin(f.now / 120) : 10;
    ctx.fillStyle = col;
    ctx.fillRect(bx, by, bw * Math.max(0, f.hp), 8);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, 8);
  }



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

  // 判定统计 + 准确率（连击下方）
  if (f.stats) {
    const judged = f.stats.perfect + f.stats.good + f.stats.miss;
    if (judged > 0) {
      const acc = ((f.stats.perfect + f.stats.good * 0.5) / judged) * 100;
      const y = f.combo > 0 ? 58 + Math.round(h * 0.062) + 52 : 82;
      ctx.textAlign = "left";
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(`P ${f.stats.perfect} · G ${f.stats.good} · M ${f.stats.miss}`, 28, y);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText(`ACC ${acc.toFixed(1)}%`, 28, y + 18);
    }
  }

  // 判定浮字（屏幕中上部居中，淡出）
  if (f.judgement && f.judgement.until > f.now) {
    const a = Math.min(1, (f.judgement.until - f.now) / 300);
    ctx.textAlign = "center";
    ctx.globalAlpha = a;
    ctx.shadowColor = f.judgement.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = f.judgement.color;
    ctx.font = `800 ${Math.round(h * 0.045)}px system-ui, sans-serif`;
    ctx.fillText(f.judgement.text, w / 2, h * 0.3);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // 倒计时大号数字
  if (f.countText) {
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(255,255,255,0.5)";
    ctx.shadowBlur = 30;
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${Math.round(h * 0.22)}px system-ui, sans-serif`;
    ctx.fillText(f.countText, w / 2, h * 0.45);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

/**
 * 演奏区固定 16:9：背景铺满整个画布，鼓阵/车道/音符/HUD 全部布局在
 * 画布内居中的 16:9 逻辑区域里，窗口比例变化时构图不变形。
 */
export function stageViewport(w: number, h: number) {
  const target = 16 / 9;
  let vw = w;
  let vh = w / target;
  if (vh > h) {
    vh = h;
    vw = h * target;
  }
  return { x: (w - vw) / 2, y: (h - vh) / 2, w: vw, h: vh };
}

export function renderStage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  f: StageFrame,
) {
  drawBackground(ctx, w, h);
  const v = stageViewport(w, h);
  const parts = f.parts ?? DRUM_PARTS.map((p) => p.id);

  ctx.save();
  ctx.translate(v.x, v.y);
  drawLanes(ctx, v.w, v.h, parts);

  // 鼓盘与音符合并成一条按纵深排序的绘制队列：越靠下（离玩家越近）越后画，
  // 于是飞行中的音符会被更近的鼓面正确遮挡。
  const items: DepthItem[] = [];
  for (const id of parts) {
    const expiry = f.flashes[id] ?? 0;
    const intensity = Math.max(0, Math.min(1, (expiry - f.now) / FLASH_MS));
    if (expiry > (lastFlash[id] ?? 0)) {
      spawnSparks(PAD_ANCHORS[id], PART_BY_ID[id].color, v.w, v.h, f.now);
      lastFlash[id] = expiry;
    }
    const missExpiry = f.missFlashes?.[id] ?? 0;
    const miss = Math.max(0, Math.min(1, (missExpiry - f.now) / 240));
    items.push({
      depth: PAD_ANCHORS[id].cy,
      draw: () => drawPad(ctx, id, intensity, v.w, v.h, miss),
    });
  }
  items.push(...noteItems(ctx, v.w, v.h, f));
  items.sort((a, b) => a.depth - b.depth);
  for (const it of items) it.draw();

  drawParticles(ctx, f.now);
  ctx.restore();

  drawVignette(ctx, w, h);
  ctx.save();
  ctx.translate(v.x, v.y);
  drawHud(ctx, v.w, v.h, f);
  ctx.restore();
}


// ================= 映射屏复用：静态鼓盘阵 =================

export interface PadArrayOptions {
  parts: readonly PartId[];
  flashes: Record<string, number>;
  now: number;
  /** 当前选中编辑的鼓盘（白色虚线圈高亮） */
  selected?: PartId | null;
}

/** 静态鼓盘阵（无车道/音符/HUD），与游玩屏同一套摆位与绘制 */
export function renderPadArray(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: PadArrayOptions,
) {
  drawBackground(ctx, w, h);
  const v = stageViewport(w, h);
  ctx.save();
  ctx.translate(v.x, v.y);
  const sorted = [...opts.parts].sort(
    (a, b) => PAD_ANCHORS[a].cy - PAD_ANCHORS[b].cy,
  );
  for (const id of sorted) {
    const expiry = opts.flashes[id] ?? 0;
    const intensity = Math.max(0, Math.min(1, (expiry - opts.now) / FLASH_MS));
    drawPad(ctx, id, intensity, v.w, v.h);
    if (opts.selected === id) {
      const a = PAD_ANCHORS[id];
      const p = padPixels(a, v.w, v.h);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.ellipse(
        p.cx,
        p.cy,
        p.rx + 8,
        (a.square ? p.rx : p.ry) + 8,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
  drawVignette(ctx, w, h);
}


/** 点击命中测试：返回命中的鼓盘（近处优先） */
export function partAtPoint(
  parts: readonly PartId[],
  x: number,
  y: number,
  w: number,
  h: number,
): PartId | null {
  const v = stageViewport(w, h);
  const lx = x - v.x;
  const ly = y - v.y;
  const sorted = [...parts].sort((a, b) => PAD_ANCHORS[b].cy - PAD_ANCHORS[a].cy);
  for (const id of sorted) {
    const a = PAD_ANCHORS[id];
    const p = padPixels(a, v.w, v.h);
    const ry = a.square ? p.rx : p.ry; // 方形踏板纵向按全半径判定
    const dx = (lx - p.cx) / (p.rx * 1.15);
    const dy = (ly - p.cy) / (ry * 1.6);
    if (dx * dx + dy * dy <= 1) return id;
  }
  return null;
}
