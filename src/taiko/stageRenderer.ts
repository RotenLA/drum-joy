/**
 * 舞台下落式渲染器：扇形鼓盘阵 + 顶部收束段辐射车道
 *
 * 纯 Canvas 2D 伪 3D，与 React 解耦。鼓盘摆位/颜色全部来自
 * laneLayouts 的 PAD_ANCHORS / DRUM_PARTS，本文件只负责绘制。
 *
 * 场景：干净的暗夜网格背景（深色渐变 + 地平线 + 淡透视网格 + 中心聚光），
 * 9 条细光车道按「三排独立收束段」辐射到各排鼓盘（宽约一个通鼓，非单点），
 * 音符由小变大滑向鼓盘，鼓盘即判定落点，命中时鼓盘增亮回弹并喷火花粒子。
 * 踏板为斜放的立方体（顶面旋转后按 0.42 均匀压扁，与鼓面椭圆同一压扁比）。
 */
import type { TaikoChart } from "@/shared/taikoChart";
import {
  DRUM_PARTS,
  PAD_ANCHORS,
  PART_BY_ID,
  partOfNote,
  type PadAnchor,
  type PartId,
} from "./laneLayouts";
import { quality } from "./perf";
import { stickPoint, type StickLayer } from "./stickMapping";
import type { StickLayerTransition } from "./stickInput";
import {
  padSprite,
  padSpriteHit,
  padSpriteMeta,
  pedalSprite,
  preloadPadSprites,
  stageBgSprite,
} from "./padSprites";

if (typeof document !== "undefined") preloadPadSprites();

/**
 * 当前帧的画质开关（每帧进入 renderStage / renderPadArray 时刷新）。
 * GLOW=false 时全部 shadowBlur 走 0，安卓中低端机上这一项能省掉大半开销。
 */
let GLOW = true;
/** 当前实际画质，控制连线流光与命中环复杂度。 */
let QUALITY_TIER: "high" | "medium" | "low" = "high";
/** 单次命中喷出的粒子数（低档为 0） */
let SPARKS = 12;
/** 粒子总量上限，超出丢弃最旧的 */
const PARTICLE_CAP = 120;

/** 逐尺寸缓存的鼓盘几何（像素位置、半径、车道起点、旋转角） */
interface PadGeom {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  gx: number;
  gy: number;
  rot: number;
}
let geomKey = "";
let geomCache: Partial<Record<PartId, PadGeom>> = {};

/** 鼓盘几何：只在画布尺寸变化时重算一次 */
function geomOf(id: PartId, w: number, h: number): PadGeom {
  const key = `${Math.round(w)}x${Math.round(h)}`;
  if (key !== geomKey) {
    geomKey = key;
    geomCache = {};
  }
  const hit = geomCache[id];
  if (hit) return hit;
  const a = PAD_ANCHORS[id];
  const p = padPixels(a, w, h);
  const g = gatePoint(a, w, h);
  const geom: PadGeom = {
    ...p,
    gx: g.x,
    gy: g.y,
    rot: Math.atan2(p.cy - g.y, p.cx - g.x) - Math.PI / 2,
  };
  geomCache[id] = geom;
  return geom;
}

/**
 * 车道收束段：三排（上/中/下）各自独立，横向半宽 0.05 → 总宽 0.10w
 * ≈ 高通/中通鼓面宽度（2×0.048w）。分层后各排车道在屏幕上按高度分开，
 * 不再长距离重叠；同列部件（高通↔踩镲踏板、中通↔底鼓）的车道接近平行。
 */
const ROW_GATES = [{ halfW: 0.044 }, { halfW: 0.044 }, { halfW: 0.044 }] as const;

/**
 * 统一等高时间线：每个部件的车道出发点固定在「自己鼓盘正上方 TRAVEL_H 屏高」处，
 * 而不是三条固定高度的横线。这样同一时刻的所有音符离各自鼓盘的距离与缩放完全一致，
 * 消除「同刻多部件看起来有先后」的错觉。
 */
const TRAVEL_H = 0.44;
/** 鼓棒角度→屏幕映射：偏航/俯仰各 ±45° 覆盖鼓阵横向/纵向范围 */
const STICK_YAW_RANGE = 45;
const STICK_PITCH_RANGE = 45;
/** 左右鼓棒颜色 */
const STICK_COLORS = { l: "#7DE2FF", r: "#FFC46B" } as const;

/** 鼓盘 cx 的分布半径（最外侧鼓盘偏离中心的距离），用于把车道起点映射进收束段 */
const PAD_SPREAD = 0.26;

/** 音符从收束段飞到鼓盘的时间（1x 速度下，毫秒） */
const LEAD_MS = 2400;
/** 判定提示圈只在临近落点时出现，避免长时间抢占视线。 */
const CUE_LEAD_MS = 650;

/** 透视加速指数：>1 让音符近大远小的同时近处加速 */
const EASE = 1.55;
/** 命中闪光时长（与 FallScreen 的 FLASH_MS 对应） */
const FLASH_MS = 200;
/** 踏板斜放角：左右镜像「外八」，顶面正方形旋转后再按 0.42 压扁 */
export const PEDAL_TILT = (12 * Math.PI) / 180;

/**
 * 不同鼓盘到收束点的斜向距离不同；按路径长度微调视觉缓动，令临近落点的
 * 同刻音符更像在同一拍抵达。只改变画面位置，t=1 与实际判定时间保持不变。
 */
function flightProgress(pad: PadGeom, t: number, h: number): number {
  const clamped = Math.max(0.02, Math.min(1, t));
  const path = Math.max(1, Math.hypot(pad.cx - pad.gx, pad.cy - pad.gy));
  const reference = Math.max(1, TRAVEL_H * h);
  const compensation = Math.max(0.82, Math.min(1.18, reference / path));
  return Math.pow(clamped, EASE * compensation);
}

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
  /** 是否绘制飞行音符（未开始时为 false，只显示鼓阵） */
  showNotes?: boolean;
  /** 精简 HUD（教学用）：不画进度条、分数、连击、判定统计 */
  minimalHud?: boolean;

  /** 判定统计（HUD 显示 P/G/M 与准确率） */
  stats?: { perfect: number; good: number; miss: number } | null;
  /** 当前准确率对应的实时评级。 */
  rating?: string | null;
  /** 生存模式血量 0~1（其他模式不传） */
  hp?: number | null;
  /** 宿主注入的鼓棒姿态（度）；null / 缺省不绘制该棒 */
  sticks?: {
    l: { p: number; y: number } | null;
    r: { p: number; y: number } | null;
    layers?: { l: StickLayer; r: StickLayer };
    transitions?: { l: StickLayerTransition | null; r: StickLayerTransition | null };
  } | null;
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

/**
 * 粒子池与闪光去重表按画布分开保存。
 * 教学页和游玩页会同时存在两块画布（尺寸不同），共用一份会让粒子按另一块
 * 画布的坐标生成，表现为火花跑到画面底部。
 */
interface CanvasFx {
  particles: Particle[];
  lastFlash: Partial<Record<PartId, number>>;
}

const canvasFx = new WeakMap<CanvasRenderingContext2D, CanvasFx>();

function fxOf(ctx: CanvasRenderingContext2D): CanvasFx {
  let fx = canvasFx.get(ctx);
  if (!fx) {
    fx = { particles: [], lastFlash: {} };
    canvasFx.set(ctx, fx);
  }
  return fx;
}


export function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * 参考宽：摆位按官方 16:9 参考图标定，画布更宽时只在两侧留白，
 * 鼓阵本体不被拉宽（角度与间距与参考图一致）。
 */
export function refWidth(w: number, h: number) {
  return Math.min((h * 16) / 9, w);
}

/** 鼓盘锚点 → 像素几何 */
function padPixels(a: PadAnchor, w: number, h: number) {
  const rw = refWidth(w, h);
  const rx = a.r * rw;
  return { cx: w / 2 + (a.cx - 0.5) * rw, cy: a.cy * h, rx, ry: rx * (a.ratio ?? 0.42) };
}

/**
 * 车道起点：横向按鼓盘 cx 等比映射进本排收束段（保持左右顺序不交叉），
 * 纵向统一取「鼓盘上方 TRAVEL_H」，让所有车道行程等高。
 */
function gatePoint(anchor: PadAnchor, w: number, h: number) {
  const g = ROW_GATES[anchor.row]!;
  const rw = refWidth(w, h);
  const x = w / 2 + (anchor.cx - 0.5) * (g.halfW / PAD_SPREAD) * rw;
  return { x, y: (anchor.cy - TRAVEL_H) * h };
}


/*
 * 鼓盘随车道旋转角在 geomOf() 里按尺寸缓存（长轴垂直于车道，面向消失点）。
 */

/**
 * 背景：干净的「暗夜网格」——深灰渐变底 + 地平线 + 极淡透视网格 + 中心微弱聚光。
 * 预先烘焙到离屏画布，之后每帧只贴一次图（安卓上省掉大半开销）。
 */
let bgCanvas: HTMLCanvasElement | null = null;
let bgKey = "";

/** 地平线高度（屏高比例，落在上排鼓盘之上） */
const HORIZON = 0.42;

function buildBackground(w: number, h: number, scale: number) {
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const cv = bgCanvas ?? document.createElement("canvas");
  bgCanvas = cv;
  cv.width = cw;
  cv.height = ch;
  const c = cv.getContext("2d");
  if (!c) return;
  c.setTransform(scale, 0, 0, scale, 0, 0);

  // 上：夜空；下：地面，都极暗
  const sky = c.createLinearGradient(0, 0, 0, h * HORIZON);
  sky.addColorStop(0, "#1d1a38");
  sky.addColorStop(1, "#3a3160");
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h * HORIZON);

  const floor = c.createLinearGradient(0, h * HORIZON, 0, h);
  floor.addColorStop(0, "#35305a");
  floor.addColorStop(1, "#1a1830");
  c.fillStyle = floor;
  c.fillRect(0, h * HORIZON, w, h - h * HORIZON);

  // 地平线
  c.strokeStyle = "rgba(120,130,155,0.22)";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, h * HORIZON);
  c.lineTo(w, h * HORIZON);
  c.stroke();

  // 透视网格：纵线汇聚到消失点，横线随距离加密
  const vpx = w / 2;
  const vpy = h * HORIZON;
  c.strokeStyle = "rgba(91,96,112,0.16)";
  c.lineWidth = 1;
  for (let i = -7; i <= 7; i++) {
    if (i === 0) continue;
    c.beginPath();
    c.moveTo(vpx + i * w * 0.035, vpy);
    c.lineTo(vpx + i * w * 0.34, h);
    c.stroke();
  }
  for (let k = 1; k <= 7; k++) {
    const t = Math.pow(k / 8, 2.1);
    const y = vpy + (h - vpy) * t;
    c.strokeStyle = `rgba(91,96,112,${0.05 + t * 0.12})`;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }

  // 中心微弱聚光 + 四角压暗
  const spot = c.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, h * 0.9);
  spot.addColorStop(0, "rgba(150,175,220,0.07)");
  spot.addColorStop(1, "rgba(150,175,220,0)");
  c.fillStyle = spot;
  c.fillRect(0, 0, w, h);

  const edge = c.createRadialGradient(w * 0.5, h * 0.5, h * 0.35, w * 0.5, h * 0.5, h * 1.05);
  edge.addColorStop(0, "rgba(4,4,6,0)");
  edge.addColorStop(1, "rgba(4,4,6,0.3)");
  c.fillStyle = edge;
  c.fillRect(0, 0, w, h);
}

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (typeof document === "undefined") return;

  // 实拍舞台背景：等比裁切铺满，轻微虚化并压暗，保证鼓面/音符对比度
  const bg = stageBgSprite();
  if (bg) {
    const s = Math.max(w / bg.naturalWidth, h / bg.naturalHeight);
    const dw = bg.naturalWidth * s;
    const dh = bg.naturalHeight * s;
    const bleed = 7;
    ctx.save();
    ctx.filter = "blur(4px)";
    ctx.drawImage(bg, (w - dw) / 2 - bleed, (h - dh) / 2 - bleed, dw + bleed * 2, dh + bleed * 2);
    ctx.restore();
    // 提亮：压暗减到 0.22，再叠一层暖色舞台光，整体更明亮欢快
    ctx.fillStyle = "rgba(10,8,20,0.22)";
    ctx.fillRect(0, 0, w, h);
    const warm = ctx.createRadialGradient(w * 0.5, h * 0.2, 0, w * 0.5, h * 0.2, h * 1.1);
    warm.addColorStop(0, "rgba(255,170,90,0.16)");
    warm.addColorStop(0.5, "rgba(170,120,255,0.08)");
    warm.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, w, h);
    return;
  }

  // 画布已带 dpr 变换，按同一比例烘焙背景，避免贴图被放大发虚
  const scale = Math.min(2, Math.max(1, ctx.getTransform().a || 1));
  const key = `${Math.round(w)}x${Math.round(h)}@${scale}`;
  if (key !== bgKey || !bgCanvas) {
    buildBackground(w, h, scale);
    bgKey = key;
  }
  if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, w, h);
}

/** 渐变缓存：尺寸不变就复用同一批渐变对象 */
let gradKey = "";
let vignetteGrad: CanvasGradient | null = null;
let laneGrads: Partial<Record<PartId, CanvasGradient>> = {};

function ensureGradCache(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const key = `${Math.round(w)}x${Math.round(h)}`;
  if (key === gradKey) return;
  gradKey = key;
  vignetteGrad = null;
  laneGrads = {};
  void ctx;
}

export function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ensureGradCache(ctx, w, h);
  if (!vignetteGrad) {
    const g = ctx.createLinearGradient(0, h * 0.72, 0, h);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.3)");
    vignetteGrad = g;
  }
  ctx.fillStyle = vignetteGrad;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
}

/**
 * 鼓盘渐变缓存：侧面/顶面渐变只随几何（半径、角度）变化，
 * 命中回弹的 10% 缩放不再新建 Gradient（视觉上不可分辨），
 * 每帧少建十几个对象，WebView 上 GC 卡顿明显下降。
 */
const padGradCache = new Map<string, CanvasGradient>();
function cachedGrad(key: string, make: () => CanvasGradient): CanvasGradient {
  let g = padGradCache.get(key);
  if (!g) {
    if (padGradCache.size > 256) padGradCache.clear();
    g = make();
    padGradCache.set(key, g);
  }
  return g;
}

function drawLanes(ctx: CanvasRenderingContext2D, w: number, h: number, parts: readonly PartId[]) {
  ensureGradCache(ctx, w, h);
  ctx.save();
  ctx.lineWidth = 1.5;
  for (const id of parts) {
    const p = geomOf(id, w, h);
    let g = laneGrads[id];
    if (!g) {
      g = ctx.createLinearGradient(p.gx, p.gy, p.cx, p.cy);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(1, "rgba(255,255,255,0.2)");
      laneGrads[id] = g;
    }
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(p.gx, p.gy);
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
 * 固定绘制层：在途音符永远处于全部实体鼓面后方，避免经过任意鼓面边缘时
 * 因纵坐标跨过排序阈值而整颗突然跳层。只有进入自身判定面后，才在到达层
 * 平滑补画一份；缩圈仍位于最上层。
 */
const TRANSIT_BAND_DEPTH = -2;
const TRANSIT_NOTE_DEPTH = -1;
const ARRIVAL_DEPTH = 2;
const CUE_DEPTH = 3;

/** 在已有底色上叠两道首尾连续的流光，避免单亮斑走到末端后突然跳回。 */
function addFlowStops(
  gradient: CanvasGradient,
  color: string,
  phase: number,
) {
  const stops: { at: number; alpha: number }[] = [{ at: 0, alpha: 0.25 }, { at: 1, alpha: 0.25 }];
  for (const [center, halfWidth, brightAlpha] of [
    [phase, 0.1, 0.58],
    [(phase + 0.5) % 1, 0.075, 0.44],
  ] as const) {
    for (const offset of [-1, 0, 1]) {
      const c = center + offset;
      if (c + halfWidth < 0 || c - halfWidth > 1) continue;
      stops.push({ at: Math.max(0, c - halfWidth), alpha: 0.27 });
      if (c >= 0 && c <= 1) stops.push({ at: c, alpha: brightAlpha });
      stops.push({ at: Math.min(1, c + halfWidth), alpha: 0.27 });
    }
  }
  stops.sort((a, b) => a.at - b.at);
  for (const stop of stops) gradient.addColorStop(stop.at, hexToRgba(color, stop.alpha));
}

/** 音符进入自身鼓面的程度（0~1），严格在旋转后的鼓面轮廓内平滑显现。 */
function arrivalBlend(pad: PadGeom, x: number, y: number, angle: number): number {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const px = x - pad.cx;
  const py = y - pad.cy;
  const dx = (px * cos - py * sin) / Math.max(1, pad.rx);
  const dy = (px * sin + py * cos) / Math.max(1, pad.ry);
  const distance = Math.hypot(dx, dy);
  const raw = Math.max(0, Math.min(1, (1 - distance) / 0.55));
  return raw * raw * (3 - 2 * raw);
}

/** 音符、色带与缩圈共用素材中实测的鼓面角度。 */
function noteAngle(part: PartId, pad: PadGeom): number {
  const measured = padSpriteMeta(part)?.ringAngleDeg;
  return measured === undefined ? pad.rot : (measured * Math.PI) / 180;
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
  const notes = f.chart.notes;

  const pushNote = (n: TaikoChart["notes"][number]) => {
    if (n.note === undefined) return;
    const part = partOfNote(n.note);
    if (!part) return;
    const hold = n.holdMs && n.holdMs > 0 ? n.holdMs : 0;
    // t: 0 = 收束段，1 = 鼓盘（到达即命中，不再绘制）
    const t = 1 - ((n.timeMs - f.timeMs) * f.speed) / LEAD_MS;
    const tTail = hold ? 1 - ((n.timeMs + hold - f.timeMs) * f.speed) / LEAD_MS : t;
    if (t <= 0.02) return;
    if (tTail >= 1) return;

    const anchor = PAD_ANCHORS[part];
    const pad = geomOf(part, w, h);
    const g0 = { x: pad.gx, y: pad.gy };
    const at = (tt: number) => {
      const p = flightProgress(pad, tt, h);
      return {
        p,
        x: g0.x + (pad.cx - g0.x) * p,
        y: g0.y + (pad.cy - g0.y) * p,
        // 落到鼓面时 = 鼓面的 70%；远端约 13%，重击额外放大
        // 所有鼓件统一基准尺寸，不随鼓面大小/重击变化
        rx: Math.max(3, Math.min(w, h) * 0.05 * (0.18 + 0.82 * p)),
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
    // 踏板顶面朝向：正方形先 rotate(th)，再统一压扁 0.42。
    // 长音符色带沿同一朝向取宽度方向，才和踏板/音符块看起来是一体的。
    const pedalTh = part === "kick" ? -PEDAL_TILT : PEDAL_TILT;
    const faceAngle = anchor.square ? pedalTh : noteAngle(part, pad);

    const drawHead = (opacity: number) => {
      if (!headVisible || opacity <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = alpha * opacity;
      ctx.shadowColor = color;
      ctx.translate(x, y);
      ctx.shadowBlur = GLOW ? 18 * scale : 0;
      ctx.lineWidth = Math.max(1.4, rx * 0.16);
      ctx.strokeStyle = color;
      ctx.fillStyle = hexToRgba(color, 0.34);
      ctx.beginPath();
      if (anchor.square) {
        ctx.save();
        ctx.scale(1, 0.42);
        ctx.rotate(pedalTh);
        ctx.roundRect(-rx, -rx, rx * 2, rx * 2, rx * 0.28);
        ctx.restore();
      } else {
        ctx.ellipse(0, 0, rx, rx * 0.5, faceAngle, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    // 长音符为平直切边的透视色带；两道连续流光避免机械地单点扫动。
    if (hold) {
      items.push({
        depth: TRANSIT_BAND_DEPTH,
        draw: () => {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.shadowColor = color;
           const pathX = head.x - tail.x;
           const pathY = head.y - tail.y;
           const pathLen = Math.max(0.001, Math.hypot(pathX, pathY));
           const ux = -pathY / pathLen;
           const uy = pathX / pathLen;
          const tailW = tail.rx * 0.82;
          const headW = head.rx * 0.82;
          ctx.shadowBlur = GLOW ? 14 * scale : 0;
          const flow = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
           const phase = (f.now % 1400) / 1400;
           if (QUALITY_TIER !== "low") addFlowStops(flow, color, phase);
           else {
             flow.addColorStop(0, hexToRgba(color, 0.25));
             flow.addColorStop(1, hexToRgba(color, 0.25));
           }
          ctx.fillStyle = flow;
          ctx.strokeStyle = hexToRgba(color, 0.75);
          ctx.lineWidth = Math.max(1, rx * 0.08);
          ctx.lineJoin = "miter";
          ctx.beginPath();
          ctx.moveTo(tail.x + ux * tailW, tail.y + uy * tailW);
          ctx.lineTo(tail.x - ux * tailW, tail.y - uy * tailW);
          ctx.lineTo(head.x - ux * headW, head.y - uy * headW);
          ctx.lineTo(head.x + ux * headW, head.y + uy * headW);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        },
      });
    }

    if (!hold) {
      items.push({
        depth: TRANSIT_NOTE_DEPTH,
        draw: () => drawHead(1),
      });
    }

    const arriving = arrivalBlend(pad, x, y, faceAngle);
    if (!hold && arriving > 0) {
      items.push({
        depth: ARRIVAL_DEPTH,
        draw: () => drawHead(arriving),
      });
    }
  };

  // 长音符（如「整曲踩住」的左踏板）时长远超可见时间窗，单独取一份小列表，
  // 只要还没结束就一直绘制，不受下面的时间窗裁剪影响。
  for (const i of holdIndicesOf(f.chart)) pushNote(notes[i]!);

  // 普通音符：只处理可见时间窗内的，二分定位起点，右边界一到就跳出，
  // 不再每帧遍历整首歌上千个音符。
  const span = LEAD_MS / Math.max(0.1, f.speed);
  const from = f.timeMs - 100;
  const until = f.timeMs + span;
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.timeMs < from) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < notes.length; i++) {
    const n = notes[i]!;
    if (n.timeMs > until) break;
    if ((n.holdMs ?? 0) > 0) continue;
    pushNote(n);
  }

  return items;
}

/** 长音符下标（按谱面缓存，通常只有一条） */
const holdIndexCache = new WeakMap<TaikoChart, number[]>();
function holdIndicesOf(chart: TaikoChart): number[] {
  const hit = holdIndexCache.get(chart);
  if (hit) return hit;
  const list: number[] = [];
  chart.notes.forEach((n, i) => {
    if ((n.holdMs ?? 0) > 0) list.push(i);
  });
  holdIndexCache.set(chart, list);
  return list;
}

function spawnSparks(fx: CanvasFx, id: PartId, color: string, w: number, h: number, now: number) {
  const p = geomOf(id, w, h);
  const k = h / 650;
  if (SPARKS <= 0) return;
  for (let i = 0; i < SPARKS; i++) {
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const sp = (0.06 + Math.random() * 0.12) * k;
    fx.particles.push({
      x: p.cx + (Math.random() - 0.5) * p.rx * 1.2,
      y: p.cy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      born: now,
      life: 320 + Math.random() * 220,
      color,
    });
  }
  if (fx.particles.length > PARTICLE_CAP)
    fx.particles.splice(0, fx.particles.length - PARTICLE_CAP);
}

function drawParticles(ctx: CanvasRenderingContext2D, fx: CanvasFx, now: number) {
  ctx.save();
  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const pt = fx.particles[i]!;
    const age = now - pt.born;
    if (age >= pt.life) {
      fx.particles.splice(i, 1);
      continue;
    }
    const x = pt.x + pt.vx * age;
    const y = pt.y + pt.vy * age + 0.0004 * age * age; // 轻微下坠
    const a = 1 - age / pt.life;
    ctx.globalAlpha = a;
    ctx.shadowColor = pt.color;
    ctx.shadowBlur = GLOW ? 6 : 0;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 不增加粒子的命中冲击环：复用命中闪光进度，按画质减少层数。 */
function drawImpactRing(
  ctx: CanvasRenderingContext2D,
  id: PartId,
  intensity: number,
  w: number,
  h: number,
) {
  if (intensity <= 0 || QUALITY_TIER === "low") return;
  const pad = geomOf(id, w, h);
  const anchor = PAD_ANCHORS[id];
  const color = PART_BY_ID[id].color;
  const progress = 1 - intensity;
  const scale = 0.94 + progress * 0.62;
  const alpha = Math.sin(progress * Math.PI) * 0.82;
  if (alpha <= 0.01) return;

  const path = (ringScale: number) => {
    ctx.beginPath();
    if (anchor.square) {
      const th = id === "kick" ? -PEDAL_TILT : PEDAL_TILT;
      ctx.save();
      ctx.scale(1, 0.42);
      ctx.rotate(th);
      const r = pad.rx * ringScale;
      ctx.roundRect(-r, -r, r * 2, r * 2, r * 0.24);
      ctx.restore();
    } else {
      const meta = padSpriteMeta(id);
      const angle = meta ? (meta.ringAngleDeg * Math.PI) / 180 : pad.rot;
      ctx.ellipse(0, 0, pad.rx * ringScale, pad.ry * ringScale, angle, 0, Math.PI * 2);
    }
  };

  ctx.save();
  ctx.translate(pad.cx, pad.cy);
  ctx.strokeStyle = hexToRgba(color, alpha);
  ctx.lineWidth = Math.max(1.5, pad.rx * 0.045);
  ctx.shadowColor = color;
  ctx.shadowBlur = GLOW ? 14 * alpha : 0;
  path(scale);
  ctx.stroke();

  if (QUALITY_TIER === "high") {
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, pad.rx * 0.022);
    path(scale + 0.16);
    ctx.stroke();

    // 一道快速扫过的亮弧，比增加粒子更轻量。
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 0;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.ellipse(0, 0, pad.rx * scale, pad.ry * scale, pad.rot, -Math.PI * 0.85 + progress * 2.2, -Math.PI * 0.25 + progress * 2.2);
    ctx.stroke();
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
  const RY = ry * s;
  const th = mirror ? -PEDAL_TILT : PEDAL_TILT;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const depth = RY * 1.0; // 盒体厚度
  const depth0 = ry * 1.0; // 未缩放厚度（渐变缓存用）

  // 顶面四角：地板坐标（未压扁的正方形）先旋转，再按 0.42 压扁 —— 与鼓面椭圆同一投影规则
  // 先算未缩放角（top0），命中回弹只做整体缩放，渐变可按键 radius 缓存
  const corner0 = (sx: number, sy: number) => {
    const fx = sx * rx;
    const fy = sy * rx;
    return { x: fx * cos - fy * sin, y: (fx * sin + fy * cos) * 0.42 };
  };
  const top0 = [corner0(-1, -1), corner0(1, -1), corner0(1, 1), corner0(-1, 1)];
  const top = top0.map((p) => ({ x: p.x * s, y: p.y * s }));
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

  // 侧面：上暗下更暗的纵向渐变 + 部件色淡染（渐变按未缩放几何缓存）
  const gk = `sq|${mirror ? 1 : 0}|${rx.toFixed(1)}`;
  for (const [i, j] of visibleEdges) {
    const a = top[i]!;
    const b = top[j]!;
    const my0 = (top0[i]!.y + top0[j]!.y) / 2;
    const side = cachedGrad(`${gk}|s|${my0.toFixed(1)}`, () => {
      const g = ctx.createLinearGradient(0, my0, 0, my0 + depth0);
      g.addColorStop(0, "#1e1e24");
      g.addColorStop(1, "#0a0a0d");
      return g;
    });
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

  // 顶面：后暗前亮（与鼓的方向性顶光一致）+ 部件色淡染（缓存）
  const ys0 = top0.map((p) => p.y);
  const yMin = Math.min(...ys0);
  const yMax = Math.max(...ys0);
  const face = cachedGrad(`${gk}|f`, () => {
    const g = ctx.createLinearGradient(0, yMin, 0, yMax);
    g.addColorStop(0, "#17171b");
    g.addColorStop(1, "#2b2b33");
    return g;
  });
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
  ctx.shadowBlur = GLOW ? 12 + 26 * intensity : 0;
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
  const p = geomOf(partId, w, h);

  if (anchor.square) {
    // 踏板：官方素材（踩下=橙，松开=黑），未加载完退回代码画法
    const sp = pedalSprite(partId, intensity > 0.02);
    if (sp) {
      const dw = p.rx * 2 * (1 + 0.06 * intensity);
      const dh = (dw * sp.naturalHeight) / sp.naturalWidth;
      ctx.save();
      ctx.translate(p.cx, p.cy);
      if (GLOW && intensity > 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 24 * intensity;
      }
      ctx.drawImage(sp, -dw / 2, -dh / 2, dw, dh);
      if (intensity > 0.02) {
        // 踩下反馈：彩色描边 + 淡色覆盖，低画质下同样可见
        ctx.shadowBlur = 0;
        ctx.globalAlpha = Math.min(1, intensity * 1.2);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, dw * 0.05);
        ctx.strokeRect(-dw / 2 - 3, -dh / 2 - 3, dw + 6, dh + 6);
        ctx.globalAlpha = 0.28 * intensity;
        ctx.fillStyle = color;
        ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
        ctx.globalAlpha = 1;
      }
      if (miss > 0) {
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.5 * miss;
        ctx.fillStyle = "rgba(8,8,10,1)";
        ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
      }
      ctx.restore();
      return;
    }
    // 左右踏板镜像「外八」斜放
    drawSquarePad(ctx, color, p.cx, p.cy, p.rx, p.ry, intensity, partId === "kick", miss);
    return;
  }

  // 手击鼓面 / 镲片：官方素材按原生比例绘制，彩圈对齐判定锚点；
  // 命中时交叉淡入「敲击发光」素材，未加载完退回代码画法。
  const sprite = padSprite(partId);
  const meta = padSpriteMeta(partId);
  if (sprite && meta) {
    const sc = 1 + 0.05 * intensity;
    const ringW = p.rx * 2 * sc;
    const dw = ringW / meta.ringFrac;
    const dh = (dw * sprite.naturalHeight) / sprite.naturalWidth;
    const ox = -meta.offX * ringW;
    const oy = -meta.offY * ringW * (anchor.ratio ?? 0.42);
    ctx.save();
    ctx.translate(p.cx + ox, p.cy + oy);
    // 实体鼓面轻微透光：后方音符仍由鼓面遮挡，只留下很淡的空间层次。
    ctx.globalAlpha = 0.94;
    ctx.drawImage(sprite, -dw / 2, -dh / 2, dw, dh);
    if (intensity > 0) {
      const hit = padSpriteHit(partId);
      ctx.globalAlpha = Math.min(1, intensity * 1.2);
      if (hit) {
        ctx.drawImage(hit, -dw / 2, -dh / 2, dw, dh);
      } else {
        if (GLOW) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 26 * intensity;
        }
        ctx.drawImage(sprite, -dw / 2, -dh / 2, dw, dh);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
    }
    if (miss > 0) {
      ctx.globalAlpha = 0.5 * miss;
      ctx.fillStyle = "rgba(8,8,10,1)";
      ctx.beginPath();
      ctx.ellipse(-ox, -oy, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    return;
  }



  const s = 1 + 0.1 * intensity; // 命中回弹
  const RX = p.rx * s;
  const RY = p.ry * s;
  ctx.save();
  ctx.translate(p.cx, p.cy);
  // 鼓盘整体随车道旋转：鼓腔/盘面/描边/命中闪一起转，等效鼓面朝向来球方向倾斜
  ctx.rotate(p.rot);

  // 鼓腔侧面：强纵向明暗 + 部件色淡染（渐变按未缩放几何缓存）
  const depth = RY * 0.9;
  const gk = `rd|${p.rx.toFixed(1)}`;
  const side = cachedGrad(`${gk}|s`, () => {
    const g = ctx.createLinearGradient(0, 0, 0, p.ry * 0.9 + p.ry);
    g.addColorStop(0, "#232329");
    g.addColorStop(1, "#0a0a0d");
    return g;
  });
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

  // 盘面：方向性顶光（上方来光，缓存）
  const face = cachedGrad(`${gk}|f`, () => {
    const g = ctx.createRadialGradient(0, -p.ry * 0.45, p.ry * 0.2, 0, 0, p.rx);
    g.addColorStop(0, "#2b2b32");
    g.addColorStop(1, "#121215");
    return g;
  });
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
  ctx.shadowBlur = GLOW ? 12 + 26 * intensity : 0;
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

/**
 * 轻量判定缩圈：形状与目标鼓面一致，从外侧收到鼓沿并在到点前淡出。
 * 不使用填充，低画质也只需一条描边。
 */
function drawCueOutline(
  ctx: CanvasRenderingContext2D,
  partId: PartId,
  remainingMs: number,
  w: number,
  h: number,
  synchronized = false,
) {
  const progress = Math.max(0, Math.min(1, 1 - remainingMs / CUE_LEAD_MS));
  const scale = 1.55 - progress * 0.5;
  const arrivalPulse = synchronized && remainingMs < 150
    ? Math.sin(Math.max(0, Math.min(1, (150 - remainingMs) / 150)) * Math.PI)
    : 0;
  const alpha = Math.min(0.72, Math.sin(progress * Math.PI) * 0.48 + arrivalPulse * 0.2);
  if (alpha <= 0.01) return;

  const anchor = PAD_ANCHORS[partId];
  const pad = geomOf(partId, w, h);
  const spriteMeta = padSpriteMeta(partId);
  const color = PART_BY_ID[partId].color;
  ctx.save();
  ctx.translate(pad.cx, pad.cy);
  ctx.strokeStyle = hexToRgba(color, alpha);
  ctx.lineWidth = Math.max(1.2, pad.rx * 0.034);
  ctx.shadowColor = color;
  ctx.shadowBlur = GLOW ? 5 : 0;

  ctx.beginPath();
  if (anchor.square) {
    const th = partId === "kick" ? -PEDAL_TILT : PEDAL_TILT;
    ctx.save();
    ctx.scale(1, 0.42);
    ctx.rotate(th);
    const r = pad.rx * scale;
    ctx.roundRect(-r, -r, r * 2, r * 2, r * 0.24);
    ctx.restore();
  } else {
    const ringAngle = spriteMeta ? (spriteMeta.ringAngleDeg * Math.PI) / 180 : pad.rot;
    ctx.ellipse(0, 0, pad.rx * scale, pad.ry * scale, ringAngle, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/** 每个部件只取最近一颗即将到达的音符，避免密集段叠出多圈。 */
function cueItems(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  f: StageFrame,
  parts: readonly PartId[],
): DepthItem[] {
  const allowed = new Set(parts);
  const nearest = new Map<PartId, { remaining: number; synchronized: boolean }>();
  const upcoming: { part: PartId; timeMs: number }[] = [];
  const from = f.timeMs;
  const until = from + CUE_LEAD_MS;
  const notes = f.chart.notes;
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.timeMs < from) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < notes.length; i++) {
    const note = notes[i]!;
    if (note.timeMs > until) break;
    if (note.note === undefined) continue;
    const part = partOfNote(note.note);
    if (!part || !allowed.has(part)) continue;
    upcoming.push({ part, timeMs: note.timeMs });
  }
  for (const note of upcoming) {
    if (nearest.has(note.part)) continue;
    const synchronized = upcoming.some(
      (other) => other.part !== note.part && Math.abs(other.timeMs - note.timeMs) <= CHORD_TOL_MS,
    );
    nearest.set(note.part, { remaining: note.timeMs - from, synchronized });
  }
  return [...nearest].map(([part, cue]) => ({
    depth: CUE_DEPTH,
    draw: () => drawCueOutline(ctx, part, cue.remaining, w, h, cue.synchronized),
  }));
}

/** 同刻音符的分组容差（毫秒） */
const CHORD_TOL_MS = 30;

/** 同刻音符的混色光柱：单线连接，带轻柔外辉光与清晰亮芯。 */
function chordItems(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  f: StageFrame,
): DepthItem[] {
  const notes = f.chart.notes;
  const span = LEAD_MS / Math.max(0.1, f.speed);
  const from = f.timeMs;
  const until = f.timeMs + span;
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.timeMs < from) lo = mid + 1;
    else hi = mid;
  }

  const items: DepthItem[] = [];
  let i = lo;
  while (i < notes.length && notes[i]!.timeMs <= until) {
    const t0 = notes[i]!.timeMs;
    const group: {
      x: number;
      y: number;
      rx: number;
      ry: number;
      angle: number;
      square: boolean;
      color: string;
    }[] = [];
    let progress = 0;
    let j = i;
    while (j < notes.length && notes[j]!.timeMs - t0 <= CHORD_TOL_MS) {
      const n = notes[j]!;
      j++;
      if ((n.holdMs ?? 0) > 0 || n.note === undefined) continue;
      const part = partOfNote(n.note);
      if (!part) continue;
      const pad = geomOf(part, w, h);
      const t = 1 - ((n.timeMs - f.timeMs) * f.speed) / LEAD_MS;
      if (t <= 0.02 || t >= 1) continue;
      const p = flightProgress(pad, t, h);
      const rx = Math.max(3, Math.min(w, h) * 0.05 * (0.18 + 0.82 * p));
      const anchor = PAD_ANCHORS[part];
      progress = p;
      group.push({
        x: pad.gx + (pad.cx - pad.gx) * p,
        y: pad.gy + (pad.cy - pad.gy) * p,
        rx,
        ry: anchor.square ? rx * 0.42 : rx * (pad.ry / pad.rx),
        angle: anchor.square
          ? part === "kick" ? -PEDAL_TILT : PEDAL_TILT
          : noteAngle(part, pad),
        square: anchor.square === true,
        color: PART_BY_ID[part].color,
      });
    }
    i = j;
    if (group.length < 2) continue;
    group.sort((a, b) => a.x - b.x);
    const remainingMs = Math.max(0, t0 - f.timeMs);
    const arriveFade = Math.min(1, remainingMs / 100);
    const alpha = (0.16 + 0.08 * progress) * Math.min(1, progress * 8) * arriveFade;
    const pts = group;

    const edgeDistance = (
      point: (typeof pts)[number],
      dx: number,
      dy: number,
    ) => {
      const cos = Math.cos(-point.angle);
      const sin = Math.sin(-point.angle);
      if (point.square) {
        // 与绘制时 scale(1,.42) → rotate(angle) 的逆变换一致。
        const scaledX = dx;
        const scaledY = dy / 0.42;
        const lx = scaledX * cos - scaledY * sin;
        const ly = scaledX * sin + scaledY * cos;
        return point.rx / Math.max(Math.abs(lx), Math.abs(ly), 0.001);
      }
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      return 1 / Math.sqrt((lx * lx) / (point.rx * point.rx) + (ly * ly) / (point.ry * point.ry));
    };
    items.push({
      // 连线与在途音符同处固定后景，不再因端点跨越鼓面边缘而跳层。
      depth: TRANSIT_BAND_DEPTH + 0.1,
      draw: () => {
        ctx.save();
        ctx.lineCap = "round";
        // 三颗以上按相邻音符连续连接，每段均从两端鼓件色自然混合。
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1];
          const b = pts[k];
          if (!a || !b) continue;
          const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          gradient.addColorStop(0, hexToRgba(a.color, alpha));
          gradient.addColorStop(1, hexToRgba(b.color, alpha));
          ctx.strokeStyle = gradient;
          const averageRadius = (a.rx + b.rx) * 0.5;
          ctx.lineWidth = Math.max(3, averageRadius * 0.42);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.max(0.001, Math.hypot(dx, dy));
          const nx = dx / distance;
          const ny = dy / distance;
          const gap = Math.max(1.5, h * 0.002);
          const startOffset = edgeDistance(a, nx, ny) + gap;
          const endOffset = edgeDistance(b, -nx, -ny) + gap;
          // 两个轮廓已接触或重叠时不画线，避免退回中心后穿过色块。
          if (startOffset + endOffset >= distance - 0.5) continue;
          const ax = a.x + nx * startOffset;
          const ay = a.y + ny * startOffset;
          const bx = b.x - nx * endOffset;
          const by = b.y - ny * endOffset;
          ctx.shadowColor = a.color;
          ctx.shadowBlur = GLOW && QUALITY_TIER === "high" ? 8 : 0;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();

          ctx.shadowBlur = 0;
          ctx.strokeStyle = gradient;
          ctx.globalAlpha = 0.58;
          ctx.lineWidth = Math.max(1.4, averageRadius * 0.13);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      },
    });
  }
  return items;
}


const comboFx = { last: 0, at: 0, breakAt: 0 };
const judgeFx = { text: "", until: 0, at: 0 };

export function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, f: StageFrame) {
  ctx.save();
  const minimal = f.minimalHud === true;

  if (!minimal) {
    // 顶部细进度条
    const progress = f.chart.durationMs > 0 ? f.timeMs / f.chart.durationMs : 0;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(0, 0, w, 5);
    ctx.shadowColor = "#fc8800";
    ctx.shadowBlur = GLOW ? 10 : 0;
    ctx.fillStyle = "#fc8800";
    ctx.fillRect(0, 0, w * Math.min(1, Math.max(0, progress)), 5);
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
      ctx.shadowBlur = GLOW ? (low ? 14 + 8 * Math.sin(f.now / 120) : 10) : 0;
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
    ctx.shadowBlur = GLOW ? 10 : 0;
    ctx.fillText(String(f.score).padStart(7, "0"), 28, 58);
    ctx.shadowBlur = 0;
  }

  // 右上曲名 + BPM；超长标题在限定区域内往返滚动
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 15px system-ui, sans-serif";
  const titleRight = w - 28;
  const titleMaxWidth = Math.min(360, w * 0.42);
  const titleWidth = ctx.measureText(f.chart.title).width;
  ctx.save();
  ctx.beginPath();
  ctx.rect(titleRight - titleMaxWidth, 12, titleMaxWidth, 25);
  ctx.clip();
  if (titleWidth > titleMaxWidth) {
    const overflow = titleWidth - titleMaxWidth;
    const cycle = (f.now / Math.max(6000, overflow * 35)) % 2;
    const shift = cycle <= 1 ? cycle * overflow : (2 - cycle) * overflow;
    ctx.textAlign = "left";
    ctx.fillText(f.chart.title, titleRight - titleMaxWidth - shift, 32);
  } else {
    ctx.textAlign = "right";
    ctx.fillText(f.chart.title, titleRight, 32);
  }
  ctx.restore();
  ctx.textAlign = "right";
  ctx.fillStyle = "#5D8CF4";
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillText(`BPM ${f.chart.bpm}`, w - 28, 50);

  // 连击：分档放大变色（10/30/50/100），新增连击时跳动一下
  if (!minimal && f.combo > 0) {
    const tier = f.combo >= 100 ? 4 : f.combo >= 50 ? 3 : f.combo >= 30 ? 2 : f.combo >= 10 ? 1 : 0;
    const TIER_COLOR = ["#ffffff", "#7dd3fc", "#4ade80", "#fbbf24", "#f472b6"];
    const col = TIER_COLOR[tier]!;
    if (f.combo !== comboFx.last) {
      comboFx.at = f.now;
      comboFx.last = f.combo;
    }
    const since = f.now - comboFx.at;
    const pop = since < 160 ? 1 + 0.25 * Math.sin((since / 160) * Math.PI) : 1;
    const size = Math.round(h * 0.062 * (1 + tier * 0.12) * pop);
    ctx.textAlign = "left";
    ctx.shadowColor = col;
    ctx.shadowBlur = GLOW ? 16 + tier * 6 : 0;
    ctx.fillStyle = col;
    ctx.font = `italic 900 ${size}px system-ui, sans-serif`;
    ctx.fillText(String(f.combo), 28, 58 + size + 10);
    ctx.shadowBlur = 0;
    ctx.fillStyle = tier ? col : "rgba(255,255,255,0.45)";
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.fillText("C O M B O", 28, 58 + size + 28);
  } else if (!minimal && comboFx.last > 0) {
    // 断连：旧数字收缩淡出
    if (comboFx.breakAt === 0) comboFx.breakAt = f.now;
    const t = (f.now - comboFx.breakAt) / 280;
    if (t < 1) {
      const size = Math.round(h * 0.062 * (1 - t * 0.6));
      ctx.globalAlpha = 1 - t;
      ctx.textAlign = "left";
      ctx.fillStyle = "#f87171";
      ctx.font = `italic 900 ${size}px system-ui, sans-serif`;
      ctx.fillText(String(comboFx.last), 28, 58 + size + 10);
      ctx.globalAlpha = 1;
    } else {
      comboFx.last = 0;
      comboFx.breakAt = 0;
    }
  }
  if (f.combo > 0) comboFx.breakAt = 0;

  // 判定统计 + 准确率（连击下方）
  if (!minimal && f.stats) {
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
      if (f.rating) {
        ctx.fillStyle = "#fc8800";
        ctx.font = "900 24px system-ui, sans-serif";
        ctx.fillText(f.rating, 28, y + 48);
      }
    }
  }

  // 判定浮字（屏幕中上部居中，淡出）
  if (f.judgement && f.judgement.until > f.now) {
    const a = Math.min(1, (f.judgement.until - f.now) / 300);
    if (judgeFx.text !== f.judgement.text || judgeFx.until !== f.judgement.until) {
      judgeFx.text = f.judgement.text;
      judgeFx.until = f.judgement.until;
      judgeFx.at = f.now;
    }
    const js = f.now - judgeFx.at;
    // 弹跳：先冲到 1.35 再回到 1
    const bounce = js < 90 ? 0.7 + (js / 90) * 0.65 : js < 200 ? 1.35 - ((js - 90) / 110) * 0.35 : 1;
    ctx.textAlign = "center";
    ctx.globalAlpha = a;
    ctx.shadowColor = f.judgement.color;
    ctx.shadowBlur = GLOW ? 18 : 0;
    ctx.fillStyle = f.judgement.color;
    ctx.font = `900 ${Math.round(h * 0.072 * bounce)}px system-ui, sans-serif`;
    ctx.fillText(f.judgement.text, w / 2, h * 0.3);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // 倒计时大号数字
  if (f.countText) {
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(255,255,255,0.5)";
    ctx.shadowBlur = GLOW ? 30 : 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${Math.round(h * 0.22)}px system-ui, sans-serif`;
    ctx.fillText(f.countText, w / 2, h * 0.45);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

/**
 * 演奏区固定 18:9：背景铺满整个画布，鼓阵/车道/音符/HUD 全部布局在
 * 画布内居中的 2:1 逻辑区域里，窗口比例变化时构图不变形。
 */
/**
 * 鼓棒（立体棒身）：宿主给的俯仰/偏航角映射到鼓阵上的棒尖落点，
 * 棒身沿「由玩家手部指向棒尖」的方向绘制，近端粗、棒尖细，带高光与泛光。
 */
function drawStick(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pose: { p: number; y: number },
  side: "l" | "r",
  layer: StickLayer = "lower",
  transition?: StickLayerTransition | null,
  now = 0,
) {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const yaw = clamp(pose.y / STICK_YAW_RANGE);
  const pitch = clamp(pose.p / STICK_PITCH_RANGE);
  const color = STICK_COLORS[side];

  // 棒尖落点：按宿主标定的真实鼓面角度分区映射（stickMapping），
  // 横向与鼓盘锚点同一坐标系（16:9 参考宽），角度落在某分区即落在该鼓面上
  const rw = refWidth(w, h);
  const toX = (nx: number) => w / 2 + (nx - 0.5) * rw;
  const transitionMs = 150;
  const rawT = transition ? Math.max(0, Math.min(1, (now - transition.at) / transitionMs)) : 1;
  const layerMix = transition && rawT < 1
    ? transition.from === "upper" ? 1 - rawT : rawT
    : undefined;
  const point = stickPoint(pose, layer, layerMix);
  const tipX = toX(point.x);
  const tipY = point.y * h;

  // 棒身方向：由屏幕下方玩家手部指向棒尖，左右手各自外偏
  const handX = toX(side === "l" ? 0.3 : 0.7) + yaw * 0.06 * rw;
  const handY = h * 1.06 + pitch * 0.05 * h;

  const dx = tipX - handX;
  const dy = tipY - handY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // 棒长：屏幕高度的一半左右，随俯仰略变（抬起看起来更短）
  const stickLen = Math.min(len, h * (0.26 - pitch * 0.03));
  const buttX = tipX - ux * stickLen;
  const buttY = tipY - uy * stickLen;
  const nx = -uy;
  const ny = ux;
  const wTip = Math.max(0.9, h * 0.003);
  const wButt = Math.max(1.4, h * 0.0065);

  ctx.save();
  ctx.lineJoin = "round";

  // 棒身：锥形四边形 + 纵向渐变（木色偏冷/暖由棒色染）
  const grad = ctx.createLinearGradient(buttX, buttY, tipX, tipY);
  grad.addColorStop(0, hexToRgba(color, 0.35));
  grad.addColorStop(0.55, hexToRgba(color, 0.7));
  grad.addColorStop(1, hexToRgba(color, 0.95));
  ctx.shadowColor = color;
  ctx.shadowBlur = GLOW ? h * 0.03 : 0;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(buttX + nx * wButt, buttY + ny * wButt);
  ctx.lineTo(tipX + nx * wTip, tipY + ny * wTip);
  ctx.lineTo(tipX - nx * wTip, tipY - ny * wTip);
  ctx.lineTo(buttX - nx * wButt, buttY - ny * wButt);
  ctx.closePath();
  ctx.fill();

  // 高光：偏一侧的细亮线，制造圆柱体感
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = Math.max(1, wTip * 0.5);
  ctx.beginPath();
  ctx.moveTo(buttX + nx * wButt * 0.35, buttY + ny * wButt * 0.35);
  ctx.lineTo(tipX + nx * wTip * 0.35, tipY + ny * wTip * 0.35);
  ctx.stroke();

  // 棒头：小球 + 落点光圈
  ctx.shadowColor = color;
  ctx.shadowBlur = GLOW ? h * 0.04 : 0;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(tipX, tipY, wTip * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = hexToRgba(color, 0.55);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(tipX, tipY, wTip * 4.2, wTip * 4.2 * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function stageViewport(w: number, h: number) {
  const target = 18 / 9;
  let vw = w;
  let vh = w / target;
  if (vh > h) {
    vh = h;
    vw = h * target;
  }
  return { x: (w - vw) / 2, y: (h - vh) / 2, w: vw, h: vh };
}

export function renderStage(ctx: CanvasRenderingContext2D, w: number, h: number, f: StageFrame) {
  const q = quality.params;
  GLOW = q.glow;
  SPARKS = q.particles;
  QUALITY_TIER = quality.tier;
  drawBackground(ctx, w, h);
  const v = stageViewport(w, h);
  const parts = f.parts ?? DRUM_PARTS.map((p) => p.id);

  ctx.save();
  ctx.translate(v.x, v.y);
  drawLanes(ctx, v.w, v.h, parts);

  // 固定层级队列：连续色带 → 在途音符 → 全部实体鼓面 → 到达自身鼓面的音符 → 缩圈。
  // 不再使用飞行位置切换层级，因此任意交叉路径经过鼓面边缘都不会突然前后跳动。
  const items: DepthItem[] = [];
  const fx = fxOf(ctx);
  for (const id of parts) {
    const expiry = f.flashes[id] ?? 0;
    const intensity = Math.max(0, Math.min(1, (expiry - f.now) / FLASH_MS));
    if (expiry > (fx.lastFlash[id] ?? 0)) {
      spawnSparks(fx, id, PART_BY_ID[id].color, v.w, v.h, f.now);
      fx.lastFlash[id] = expiry;
    }
    const missExpiry = f.missFlashes?.[id] ?? 0;
    const miss = Math.max(0, Math.min(1, (missExpiry - f.now) / 240));
    items.push({
      depth: PAD_ANCHORS[id].cy,
      draw: () => drawPad(ctx, id, intensity, v.w, v.h, miss),
    });
    if (intensity > 0 && QUALITY_TIER !== "low") {
      items.push({
        depth: PAD_ANCHORS[id].cy + 0.01,
        draw: () => drawImpactRing(ctx, id, intensity, v.w, v.h),
      });
    }
  }
  if (f.showNotes !== false) {
    items.push(...noteItems(ctx, v.w, v.h, f));
    items.push(...cueItems(ctx, v.w, v.h, f, parts));
    items.push(...chordItems(ctx, v.w, v.h, f));

  }
  items.sort((a, b) => a.depth - b.depth);
  for (const it of items) it.draw();

  drawParticles(ctx, fx, f.now);
  // 鼓棒画在鼓盘/音符上层
  if (f.sticks) {
    if (f.sticks.l) drawStick(ctx, v.w, v.h, f.sticks.l, "l", f.sticks.layers?.l, f.sticks.transitions?.l, f.now);
    if (f.sticks.r) drawStick(ctx, v.w, v.h, f.sticks.r, "r", f.sticks.layers?.r, f.sticks.transitions?.r, f.now);
  }
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
  /** 位置捕捉时显示实时鼓棒 */
  sticks?: StageFrame["sticks"];
}

/** 静态鼓盘阵（无车道/音符/HUD），与游玩屏同一套摆位与绘制 */
export function renderPadArray(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: PadArrayOptions,
) {
  GLOW = quality.params.glow;
  drawBackground(ctx, w, h);
  const v = stageViewport(w, h);
  ctx.save();
  ctx.translate(v.x, v.y);
  const sorted = [...opts.parts].sort((a, b) => PAD_ANCHORS[a].cy - PAD_ANCHORS[b].cy);
  for (const id of sorted) {
    const expiry = opts.flashes[id] ?? 0;
    const intensity = Math.max(0, Math.min(1, (expiry - opts.now) / FLASH_MS));
    drawPad(ctx, id, intensity, v.w, v.h);
    if (opts.selected === id) {
      const a = PAD_ANCHORS[id];
      const p = geomOf(id, v.w, v.h);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.ellipse(p.cx, p.cy, p.rx + 8, (a.square ? p.rx : p.ry) + 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  if (opts.sticks?.l) drawStick(ctx, v.w, v.h, opts.sticks.l, "l", opts.sticks.layers?.l, opts.sticks.transitions?.l, opts.now);
  if (opts.sticks?.r) drawStick(ctx, v.w, v.h, opts.sticks.r, "r", opts.sticks.layers?.r, opts.sticks.transitions?.r, opts.now);
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
    const p = geomOf(id, v.w, v.h);
    const ry = a.square ? p.rx : p.ry; // 方形踏板纵向按全半径判定
    const dx = (lx - p.cx) / (p.rx * 1.15);
    const dy = (ly - p.cy) / (ry * 1.6);
    if (dx * dx + dy * dy <= 1) return id;
  }
  return null;
}
