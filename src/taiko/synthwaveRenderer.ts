/**
 * Synthwave 下落式渲染器
 *
 * 纯 Canvas 绘制，与 React 解耦。相机消失点 = 落日中心，
 * 俯仰角比经典参考图略高（地面占比更大），视角参数集中在 CAMERA。
 * 模块内无模块级随机/IO，SSR 安全；所有绘制确定性来自 hash01。
 */

import type { TaikoChart } from "@/shared/taikoChart";
import { PART_BY_ID, PART_BY_NOTE, type Zone } from "./laneLayouts";

export interface Backdrop {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

export interface FallRenderParams {
  chart: TaikoChart;
  zones: readonly Zone[];
  zoneByNote: Readonly<Record<number, Zone>>;
  timeMs: number;
  speed: number;
  /** performance.now()，用于闪光衰减与脉冲动画 */
  now: number;
  /** zoneId -> 闪光截止时刻（performance.now 基准） */
  flashes: Readonly<Record<string, number>>;
  backdrop: Backdrop | null;
  combo: number;
  score: number;
}

const COLORS = {
  skyBase: "#07031a",
  horizonGlow: "rgba(255, 78, 138, 0.30)",
  groundFar: "#1c0a38",
  groundNear: "#05020c",
  gridV: "rgba(86, 240, 255, 0.13)",
  gridH: "rgba(255, 79, 216, 0.11)",
  sunTop: "#ffd23f",
  sunMid: "#ff9e3f",
  sunBottom: "#ff4e8a",
  sunGlow: "rgba(255, 79, 160, 0.9)",
  ring: "#7df9ff",
  mountainFill: "#0b0518",
  mountainLine: "rgba(65, 240, 255, 0.5)",
  textBright: "#f5efff",
  textDim: "rgba(240, 230, 255, 0.6)",
  hudInk: "#2b0a30",
};

/** 相机参数：horizonRatio 越小视角越俯视 */
const CAMERA = {
  horizonRatio: 0.38,
  groundBottomRatio: 0.99,
  nearHalfRatio: 0.62,
  farHalfRatio: 0.05,
  depthPower: 2.1,
  sunRadiusRatio: 0.145, // 相对 min(w, h)
  sunLiftRatio: 0.35, // 落日中心高出地平线的比例（相对半径）
};

const BASE_APPROACH_MS = 2200;
const HINT_LEAD_MS = 1500;

interface Cam {
  cx: number;
  horizon: number;
  bottom: number;
  nearHalf: number;
  farHalf: number;
  power: number;
}

function makeCam(w: number, h: number): Cam {
  return {
    cx: w / 2,
    horizon: h * CAMERA.horizonRatio,
    bottom: h * CAMERA.groundBottomRatio,
    nearHalf: w * CAMERA.nearHalfRatio,
    farHalf: w * CAMERA.farHalfRatio,
    power: CAMERA.depthPower,
  };
}

/** 地面平面 (x: 0..1 横向, t: 0 远 -> 1 近) 投影到屏幕 */
function project(cam: Cam, x: number, t: number) {
  const e = Math.pow(Math.max(0, Math.min(1, t)), cam.power);
  const y = cam.horizon + (cam.bottom - cam.horizon) * e;
  const half = cam.farHalf + (cam.nearHalf - cam.farHalf) * e;
  return { x: cam.cx + (x - 0.5) * 2 * half, y, scale: half / cam.nearHalf };
}

function hash01(i: number, salt: number) {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function roundedRect(
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
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 封面底图预处理：压暗 + 模糊 + 提饱和，只跑一次 */
export function prepareBackdrop(img: HTMLImageElement): Backdrop {
  const bw = 480;
  const bh = 270;
  const canvas = document.createElement("canvas");
  canvas.width = bw;
  canvas.height = bh;
  const g = canvas.getContext("2d")!;
  g.filter = "blur(5px) brightness(0.5) saturate(1.25)";
  const s = Math.max(bw / img.width, bh / img.height);
  g.drawImage(
    img,
    (bw - img.width * s) / 2,
    (bh - img.height * s) / 2,
    img.width * s,
    img.height * s,
  );
  return { canvas, w: bw, h: bh };
}

// ---------------------------------------------------------------------------
// 落日精灵（横切线缺口），按半径缓存
// ---------------------------------------------------------------------------

let sunCache: { r: number; canvas: HTMLCanvasElement } | null = null;

function getSunSprite(r: number): HTMLCanvasElement {
  if (sunCache && Math.abs(sunCache.r - r) < 1) return sunCache.canvas;
  const size = Math.ceil(r * 2);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, COLORS.sunTop);
  grad.addColorStop(0.55, COLORS.sunMid);
  grad.addColorStop(1, COLORS.sunBottom);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r - 1, 0, Math.PI * 2);
  g.fill();
  // 下半圆横切线，越往下缺口越宽
  g.globalCompositeOperation = "destination-out";
  let y = r * 1.04;
  let gap = 1.5;
  let step = r * 0.14;
  while (y < size) {
    g.fillRect(0, y, size, gap);
    y += step;
    gap *= 1.55;
    step *= 0.93;
  }
  sunCache = { r, canvas };
  return canvas;
}

// ---------------------------------------------------------------------------
// 场景各层
// ---------------------------------------------------------------------------

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: FallRenderParams,
) {
  ctx.fillStyle = COLORS.skyBase;
  ctx.fillRect(0, 0, w, h);
  const bd = p.backdrop;
  if (bd) {
    const s = Math.max(w / bd.w, h / bd.h);
    const dw = bd.w * s;
    const dh = bd.h * s;
    ctx.drawImage(bd.canvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  // 统一压暗，让前景霓虹跳出来
  const vg = ctx.createLinearGradient(0, 0, 0, h);
  vg.addColorStop(0, "rgba(7, 3, 26, 0.55)");
  vg.addColorStop(0.5, "rgba(20, 6, 40, 0.45)");
  vg.addColorStop(1, "rgba(5, 2, 12, 0.78)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

function drawSky(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Cam,
  now: number,
) {
  // 地平线品红辉光
  const glowH = h * 0.2;
  const glow = ctx.createLinearGradient(0, cam.horizon - glowH, 0, cam.horizon + 4);
  glow.addColorStop(0, "rgba(255, 78, 138, 0)");
  glow.addColorStop(1, COLORS.horizonGlow);
  ctx.fillStyle = glow;
  ctx.fillRect(0, cam.horizon - glowH, w, glowH + 4);

  // 星星（确定性位置 + 闪烁）
  ctx.save();
  for (let i = 0; i < 90; i++) {
    const sx = hash01(i, 1) * w;
    const sy = hash01(i, 2) * cam.horizon * 0.9;
    const tw = 0.25 + 0.75 * Math.abs(Math.sin(now * 0.0011 + i * 1.7));
    ctx.globalAlpha = tw * 0.8;
    ctx.fillStyle = i % 7 === 0 ? "#bfe9ff" : "#ffffff";
    const r = i % 11 === 0 ? 1.6 : 1;
    ctx.fillRect(sx, sy, r, r);
  }
  ctx.restore();
}

function drawSun(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Cam,
  p: FallRenderParams,
) {
  const sunR = Math.min(w, h) * CAMERA.sunRadiusRatio;
  const sunCY = cam.horizon - sunR * CAMERA.sunLiftRatio;
  const sprite = getSunSprite(sunR);

  ctx.save();
  ctx.shadowColor = COLORS.sunGlow;
  ctx.shadowBlur = 42;
  ctx.drawImage(sprite, cam.cx - sunR, sunCY - sunR, sunR * 2, sunR * 2);
  ctx.restore();

  // 环形播放进度
  const progress = Math.min(1, p.timeMs / p.chart.durationMs);
  const ringR = sunR + 9;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(125, 249, 255, 0.18)";
  ctx.beginPath();
  ctx.arc(cam.cx, sunCY, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLORS.ring;
  ctx.shadowColor = COLORS.ring;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(cam.cx, sunCY, ringR, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 连击数落在落日中心（避开地平线以下的遮挡区）
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.hudInk;
  ctx.font = `800 ${Math.round(sunR * 0.52)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillText(String(p.combo), cam.cx, sunCY - sunR * 0.22);
  ctx.font = `600 ${Math.max(9, Math.round(sunR * 0.12))}px ui-monospace, monospace`;
  ctx.globalAlpha = 0.7;
  ctx.fillText("COMBO", cam.cx, sunCY + sunR * 0.14);
  ctx.restore();
}

function drawMountains(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Cam,
) {
  const baseY = cam.horizon + 1;
  for (const side of [0, 1] as const) {
    const startX = side === 0 ? -12 : w * 0.64;
    const endX = side === 0 ? w * 0.36 : w + 12;
    const n = 14;
    const peaks: { x: number; y: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const x = startX + ((endX - startX) * i) / n;
      const edge = i === 0 || i === n ? 0 : 0.3 + 0.7 * hash01(i, side * 9 + 4);
      peaks.push({ x, y: baseY - edge * h * 0.15 });
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(startX, baseY + 2);
    for (const pt of peaks) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(endX, baseY + 2);
    ctx.closePath();
    ctx.fillStyle = COLORS.mountainFill;
    ctx.globalAlpha = 0.94;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = COLORS.mountainLine;
    ctx.lineWidth = 1.25;
    ctx.shadowColor = "#41f0ff";
    ctx.shadowBlur = 6;
    ctx.stroke();
    // 简易线框：峰点到山脚
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(65, 240, 255, 0.14)";
    ctx.lineWidth = 1;
    for (let i = 1; i < n; i++) {
      const pt = peaks[i]!;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x + (endX - startX) * 0.02, baseY);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Cam,
) {
  const grad = ctx.createLinearGradient(0, cam.horizon, 0, cam.bottom);
  grad.addColorStop(0, COLORS.groundFar);
  grad.addColorStop(1, COLORS.groundNear);
  ctx.fillStyle = grad;
  ctx.fillRect(0, cam.horizon, w, cam.bottom - cam.horizon + 2);

  ctx.save();
  ctx.lineWidth = 1;
  // 纵向收束线
  ctx.strokeStyle = COLORS.gridV;
  for (let i = 1; i < 16; i++) {
    const x = i / 16;
    const a = project(cam, x, 0.015);
    const b = project(cam, x, 1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // 横向线（按深度加速分布）
  ctx.strokeStyle = COLORS.gridH;
  for (let k = 1; k <= 9; k++) {
    const t = Math.pow(k / 9, 1.7);
    const a = project(cam, 0.01, t);
    const b = project(cam, 0.99, t);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** 音符在分区内的横向落点：多部件分区按部件展开，培养位置记忆 */
export function zoneNoteX(zone: Zone, note: number): number {
  const span = zone.x1 - zone.x0;
  if (zone.parts.length <= 1) return zone.x0 + span / 2;
  const part = PART_BY_NOTE[note] ?? zone.parts[0]!;
  const idx = Math.max(0, zone.parts.indexOf(part));
  return zone.x0 + (span * (idx + 0.5)) / zone.parts.length;
}

interface ZoneLabel {
  x: number;
  y: number;
  text: string;
  color: string;
}

function drawZones(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  p: FallRenderParams,
  labels: ZoneLabel[],
) {
  for (const z of p.zones) {
    const c00 = project(cam, z.x0, z.t0);
    const c10 = project(cam, z.x1, z.t0);
    const c11 = project(cam, z.x1, z.t1);
    const c01 = project(cam, z.x0, z.t1);
    const flashA = Math.max(0, Math.min(1, ((p.flashes[z.id] ?? 0) - p.now) / 200));

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c00.x, c00.y);
    ctx.lineTo(c10.x, c10.y);
    ctx.lineTo(c11.x, c11.y);
    ctx.lineTo(c01.x, c01.y);
    ctx.closePath();
    ctx.fillStyle = rgba(z.color, z.pedal ? 0.1 : 0.07);
    ctx.fill();
    if (flashA > 0) {
      ctx.fillStyle = rgba("#ffffff", 0.2 * flashA);
      ctx.fill();
    }
    ctx.strokeStyle = rgba(z.color, 0.4 + 0.6 * flashA);
    ctx.lineWidth = 1.5 + 3 * flashA;
    ctx.shadowColor = z.color;
    ctx.shadowBlur = 8 + 20 * flashA;
    ctx.stroke();
    ctx.restore();

    // 判定沿（分区近端亮线）
    ctx.save();
    ctx.strokeStyle = rgba(z.color, 0.55 + 0.45 * flashA);
    ctx.lineWidth = 2.5 + 2.5 * flashA;
    ctx.shadowColor = z.color;
    ctx.shadowBlur = 10 + 14 * flashA;
    ctx.beginPath();
    ctx.moveTo(c01.x, c01.y);
    ctx.lineTo(c11.x, c11.y);
    ctx.stroke();
    ctx.restore();

    // 分区标签收集起来，等音符画完再统一绘制，避免被音符遮住
    const mid = project(cam, (z.x0 + z.x1) / 2, z.t1);
    labels.push({
      x: mid.x,
      y: mid.y + 12,
      text: `${z.keyLabel} · ${z.label}`,
      color: z.color,
    });

    // 下一个音符落点辉光提示
    const next = p.chart.notes.find(
      (n) =>
        n.note !== undefined &&
        p.zoneByNote[n.note]?.id === z.id &&
        n.timeMs >= p.timeMs &&
        n.timeMs - p.timeMs <= (HINT_LEAD_MS / p.speed) * 1.5,
    );
    if (next && next.note !== undefined) {
      const part = PART_BY_ID[PART_BY_NOTE[next.note]!];
      const hx = zoneNoteX(z, next.note);
      const hp = project(cam, hx, z.t1);
      const pulse = 0.5 + 0.5 * Math.sin(p.now / 110);
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.35 * pulse;
      ctx.fillStyle = part.color;
      ctx.shadowColor = part.color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.ellipse(hp.x, hp.y, 14 * hp.scale + 4, 5 * hp.scale + 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawNotes(ctx: CanvasRenderingContext2D, cam: Cam, p: FallRenderParams) {
  const approachMs = BASE_APPROACH_MS / p.speed;
  for (const n of p.chart.notes) {
    if (n.note === undefined) continue;
    if (n.timeMs - p.timeMs > approachMs) break; // 谱面按时间升序
    const zone = p.zoneByNote[n.note];
    if (!zone) continue;
    const prog = 1 - (n.timeMs - p.timeMs) / approachMs;
    if (prog < 0 || prog > 1.06) continue;

    const t = zone.t0 + Math.min(prog, 1) * (zone.t1 - zone.t0);
    const x = zoneNoteX(zone, n.note);
    const pos = project(cam, x, t);
    const part = PART_BY_ID[PART_BY_NOTE[n.note]!];

    const span = zone.x1 - zone.x0;
    const zoneNearPx = span * 2 * cam.nearHalf;
    const widthRatio =
      zone.parts.length > 1 ? 0.72 / zone.parts.length : zone.pedal ? 0.38 : 0.52;
    let cw = zoneNearPx * pos.scale * widthRatio;
    if (n.big) cw *= 1.35;
    const ch = cw * (zone.pedal ? 0.42 : 0.55);
    cw = Math.max(4, cw);

    let alpha = 1;
    if (prog < 0.12) alpha = prog / 0.12;
    if (prog > 1) alpha = Math.max(0, 1 - (prog - 1) / 0.05);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = part.color;
    ctx.shadowBlur = 6 + 14 * pos.scale;
    ctx.fillStyle = part.color;
    roundedRect(ctx, pos.x - cw / 2, pos.y - ch / 2, cw, Math.max(3, ch), 6 * pos.scale + 1);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.25 + 0.35 * pos.scale})`;
    ctx.lineWidth = Math.max(0.75, 1.5 * pos.scale);
    ctx.stroke();
    ctx.restore();
  }
}

function drawCornerHud(
  ctx: CanvasRenderingContext2D,
  w: number,
  p: FallRenderParams,
) {
  ctx.save();
  ctx.textBaseline = "top";
  ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillStyle = COLORS.textBright;
  ctx.textAlign = "left";
  ctx.fillText(`SCORE ${String(p.score).padStart(6, "0")}`, 20, 16);
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText(
    `${p.chart.title} · ${p.chart.bpm} BPM · ${p.chart.timeSignature[0]}/${p.chart.timeSignature[1]} · ${p.speed}x`,
    w - 20,
    17,
  );
  ctx.restore();
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: FallRenderParams,
) {
  const cam = makeCam(w, h);
  drawBackdrop(ctx, w, h, p);
  drawSky(ctx, w, h, cam, p.now);
  drawSun(ctx, w, h, cam, p);
  drawMountains(ctx, w, h, cam);
  drawGround(ctx, w, h, cam);
  drawZones(ctx, cam, p);
  drawNotes(ctx, cam, p);
  drawCornerHud(ctx, w, p);
}
