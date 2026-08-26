/**
 * osu! 模式渲染器：随机落点鼓盘 + 缩圈 + 连打串连线
 *
 * 沿用舞台模式的 3D 视角与封面背景（复用 stageRenderer 的背景/暗角/HUD），
 * 但没有固定鼓阵与下落车道：每个音符在舞台平面上随机生成一个带名称的鼓盘，
 * 外圈缩圈收到盘缘那一刻即判定时刻，玩家必须敲对应鼓件。
 */
import type { TaikoChart } from "@/shared/taikoChart";
import { PAD_ANCHORS, PART_BY_ID, KEY_BY_PART, type PartId } from "./laneLayouts";
import {
  PEDAL_TILT,
  drawBackground,
  drawHud,
  drawVignette,
  hexToRgba,
  type StageFrame,
} from "./stageRenderer";
import { OSU_PAD_R, buildOsuLayout, type OsuPlacement } from "./osuLayout";

/** 圆圈提前出现的时长（1x 速度下，毫秒） */
const APPROACH_MS = 1500;
/** 命中爆闪时长 */
const HIT_MS = 260;
/** Miss 淡出时长 */
const MISS_MS = 340;
/** 地板压扁比（与舞台模式一致，保持同一视角） */
const FLATTEN = 0.42;

export interface OsuFrame extends StageFrame {
  /** 每个音符的判定状态：0 未判定 / 1 命中 / 2 Miss */
  judged: Uint8Array;
  /** 每个音符判定发生的时间戳（performance.now() 基准） */
  judgedAt: Float64Array;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: string;
}

const sparks: Spark[] = [];
/** 已喷过粒子的音符下标，避免重复 */
const sparked = new Set<number>();

// 布局缓存：谱面 / 分区 / 速度不变时复用
let cacheKey = "";
let cacheLayout: OsuPlacement[] = [];
let cacheByIndex = new Map<number, OsuPlacement>();

function layoutFor(chart: TaikoChart, parts: readonly PartId[], speed: number) {
  const key = `${chart.title}|${chart.bpm}|${chart.notes.length}|${chart.durationMs}|${parts.join(",")}|${speed}`;
  if (key !== cacheKey) {
    cacheKey = key;
    cacheLayout = buildOsuLayout(chart, parts, APPROACH_MS / speed);
    cacheByIndex = new Map(cacheLayout.map((p) => [p.noteIndex, p]));
    sparks.length = 0;
    sparked.clear();
  }
  return cacheLayout;
}

function padGeom(p: OsuPlacement, w: number, h: number) {
  const rx = OSU_PAD_R * w * p.scale * (p.big ? 1.18 : 1);
  return { cx: p.cx * w, cy: p.cy * h, rx, ry: rx * FLATTEN };
}

function padPath(
  ctx: CanvasRenderingContext2D,
  p: OsuPlacement,
  rx: number,
  ry: number,
) {
  ctx.beginPath();
  if (PAD_ANCHORS[p.part].square) {
    // 踏板：方形顶面（外八斜放后压扁），与舞台模式同构
    const th = p.part === "kick" ? -PEDAL_TILT : PEDAL_TILT;
    ctx.save();
    ctx.scale(1, FLATTEN);
    ctx.rotate(th);
    ctx.roundRect(-rx, -rx, rx * 2, rx * 2, rx * 0.28);
    ctx.restore();
  } else {
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  }
}

function spawnSparks(x: number, y: number, color: string, now: number, k: number) {
  for (let i = 0; i < 14; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = (0.05 + Math.random() * 0.13) * k;
    sparks.push({
      x,
      y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp * 0.7,
      born: now,
      life: 300 + Math.random() * 220,
      color,
    });
  }
}

function drawSparks(ctx: CanvasRenderingContext2D, now: number) {
  ctx.save();
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]!;
    const age = now - s.born;
    if (age >= s.life) {
      sparks.splice(i, 1);
      continue;
    }
    const a = 1 - age / s.life;
    ctx.globalAlpha = a;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 6;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x + s.vx * age, s.y + s.vy * age + 0.0003 * age * age, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 连打串连线：把同串相邻两颗未消失的圆圈用渐隐细线相连 */
function drawChains(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  visible: OsuPlacement[],
) {
  ctx.save();
  ctx.lineWidth = 2;
  for (const p of visible) {
    if (p.chainPrev === null) continue;
    const prev = cacheByIndex.get(p.chainPrev);
    if (!prev) continue;
    const a = padGeom(prev, w, h);
    const b = padGeom(p, w, h);
    const g = ctx.createLinearGradient(a.cx, a.cy, b.cx, b.cy);
    const color = PART_BY_ID[p.part].color;
    g.addColorStop(0, hexToRgba(color, 0.05));
    g.addColorStop(1, hexToRgba(color, 0.34));
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(a.cx, a.cy);
    ctx.lineTo(b.cx, b.cy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: OsuPlacement,
  f: OsuFrame,
) {
  const approach = APPROACH_MS / f.speed;
  const dt = p.timeMs - f.timeMs; // >0 未到判定点
  const geom = padGeom(p, w, h);
  const color = PART_BY_ID[p.part].color;
  const state = f.judged[p.noteIndex] ?? 0;
  const judgedAt = f.judgedAt[p.noteIndex] ?? 0;

  // 命中 / Miss 后的收尾动画
  let hit = 0;
  let miss = 0;
  if (state === 1) {
    hit = Math.max(0, 1 - (f.now - judgedAt) / HIT_MS);
    if (hit <= 0) return;
    if (!sparked.has(p.noteIndex)) {
      sparked.add(p.noteIndex);
      spawnSparks(geom.cx, geom.cy, color, f.now, h / 650);
    }
  } else if (state === 2) {
    miss = Math.max(0, 1 - (f.now - judgedAt) / MISS_MS);
    if (miss <= 0) return;
  } else if (dt > approach || dt < -300) {
    return;
  }

  const fadeIn = Math.min(1, (approach - dt) / (approach * 0.18));
  const alpha = state === 1 ? hit : state === 2 ? miss * 0.7 : Math.max(0, fadeIn);
  const grow = state === 1 ? 1 + 0.55 * (1 - hit) : 1;
  const sink = state === 2 ? (1 - miss) * geom.ry * 1.2 : 0;
  const rx = geom.rx * grow;
  const ry = geom.ry * grow;

  ctx.save();
  ctx.translate(geom.cx, geom.cy + sink);
  ctx.globalAlpha = alpha;

  // 盘面
  const face = ctx.createRadialGradient(0, -ry * 0.5, ry * 0.2, 0, 0, rx);
  face.addColorStop(0, "#2b2b32");
  face.addColorStop(1, "#111114");
  padPath(ctx, p, rx, ry);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.fillStyle = hexToRgba(color, state === 2 ? 0.06 : 0.24 + 0.4 * hit);
  ctx.fill();

  // 描边 + 泛光
  ctx.shadowColor = color;
  ctx.shadowBlur = 14 + 30 * hit;
  ctx.strokeStyle = state === 2 ? `rgba(248,113,113,${0.8})` : hexToRgba(color, 0.92);
  ctx.lineWidth = 2.5 + 3 * hit;
  padPath(ctx, p, rx, ry);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 缩圈（仅未判定且未过判定点）
  if (state === 0 && dt > 0) {
    const k = dt / approach; // 1 → 0
    const ar = rx * (1 + 2.0 * k);
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.55 * (1 - k)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, ar, ar * FLATTEN, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 名称 + 键位（不压扁，保证可读）
  const fs = Math.max(10, Math.round(rx * 0.42));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  ctx.fillText(PART_BY_ID[p.part].label, 0, -fs * 0.15);
  ctx.fillStyle = hexToRgba(color, 0.9);
  ctx.font = `800 ${Math.round(fs * 0.78)}px system-ui, sans-serif`;
  ctx.fillText(KEY_BY_PART[p.part].label, 0, fs * 0.85);

  // 连打串序号（串内第 2 颗起标在左上）
  if (p.chainOrder > 1 && state === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = `700 ${Math.round(fs * 0.7)}px system-ui, sans-serif`;
    ctx.fillText(String(p.chainOrder), -rx * 0.72, -ry * 0.9);
  }

  ctx.restore();
}

export function renderOsu(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  f: OsuFrame,
) {
  drawBackground(ctx, w, h);

  const parts = f.parts ?? [];
  const layout = layoutFor(f.chart, parts, f.speed);
  const approach = APPROACH_MS / f.speed;

  const visible = layout.filter((p) => {
    const state = f.judged[p.noteIndex] ?? 0;
    if (state !== 0) {
      const age = f.now - (f.judgedAt[p.noteIndex] ?? 0);
      return age < Math.max(HIT_MS, MISS_MS);
    }
    const dt = p.timeMs - f.timeMs;
    return dt <= approach && dt >= -300;
  });

  drawChains(ctx, w, h, visible);
  // 远的先画，近的压上层
  for (const p of [...visible].sort((a, b) => a.cy - b.cy)) {
    drawCircle(ctx, w, h, p, f);
  }

  drawSparks(ctx, f.now);
  drawVignette(ctx, w, h);
  drawHud(ctx, w, h, f);
}
