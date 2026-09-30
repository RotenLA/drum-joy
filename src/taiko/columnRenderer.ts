/**
 * 横排下落式渲染器（按参考画面逐像素标定）。
 *
 * 静态画面（天空光束、线框山峰、两侧阶梯、六边形框、五条双线跑道、
 * 金色判定线与四个菱形、底部五个箭头判定块、脚印）直接使用从参考视频
 * 截取并清理过的底图 columns-stage.jpg；所有动态元素（音符、命中高亮、
 * 动态音符）在同一 1564×720 参考坐标系里按实测坐标绘制，保证完全重合。
 */
import plateUrl from "@/assets/columns-stage.jpg";
import noteB01 from "@/assets/columns-game/NoteB01.png";
import noteB02 from "@/assets/columns-game/NoteB02.png";
import noteB03 from "@/assets/columns-game/NoteB03.png";
import noteT01 from "@/assets/columns-game/NoteT01.png";
import noteT02 from "@/assets/columns-game/NoteT02.png";
import noteT03 from "@/assets/columns-game/NoteT03.png";
import noteT04 from "@/assets/columns-game/NoteT04.png";
import motionLight from "@/assets/columns-game/运动光线.png";
import farLight from "@/assets/columns-game/远光.png";
import waveform from "@/assets/columns-game/音波.png";
import { partOfNote, type PartId } from "./laneLayouts";
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
/**
 * 上排四条红线的独立出生点。红线标注的斜率依次约为
 * -0.94 / 0 / 0.49 / 0.91，不与下排中央消失点共用。
 */
const TOP_SPAWNS: readonly [number, number][] = [[691, 172], [785, 172], [820, 172], [879, 172]];
/** 1x 在 1564×720 参考画面中的恒定移动速度（px/ms）。 */
const FALL_PX_PER_MS = (PAD_HIT_Y - HORIZON_Y) / 2200;
const FLASH_MS = 200;

const GOLD = "#ffd84a";

const BOTTOM_SLOTS: readonly (PartId | null)[] = [null, "hihat", "snare", "kick", "floorTom"];
const TOP_SLOTS: readonly PartId[] = ["crash", "highTom", "midTom", "ride"];

interface Slot { row: 0 | 1; index: number }
interface Xf { s: number; tx: number; ty: number }
interface Placed {
  row: 0 | 1; index: number; timeMs: number; label: string | null;
  /** 参考坐标 */
  cx: number; cy: number; progress: number; alpha: number;
}

let plate: HTMLImageElement | null = null;
const images = new Map<string, HTMLImageElement>();
function plateImage(): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  if (!plate) {
    plate = new Image();
    plate.decoding = "async";
    plate.src = plateUrl;
  }
  return plate.complete && plate.naturalWidth > 0 ? plate : null;
}

function loadedImage(url: string): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  let image = images.get(url);
  if (!image) {
    image = new Image();
    image.decoding = "async";
    image.src = url;
    images.set(url, image);
  }
  return image.complete && image.naturalWidth > 0 ? image : null;
}

const BOTTOM_IMAGES = [noteB01, noteB01, noteB02, noteB01, noteB03] as const;
const TOP_IMAGES = [noteT01, noteT02, noteT03, noteT04] as const;

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

function downbeatPulse(f: StageFrame): number {
  if (!f.motionActive || f.timeMs < 0) return 0;
  const map = f.chart.beatMap;
  let nearest = Number.POSITIVE_INFINITY;
  if (map && map.beats.length) {
    for (let i = map.barPhase; i < map.beats.length; i += map.beatsPerBar) {
      const beat = map.beats[i];
      if (beat === undefined) continue;
      const d = Math.abs(f.timeMs - beat);
      if (d < nearest) nearest = d;
      if (beat > f.timeMs + 180) break;
    }
  } else {
    const grid = f.chart.grid;
    const barMs = grid
      ? grid.stepMs * grid.stepsPerBar
      : (60000 / Math.max(1, f.chart.bpm)) * Math.max(1, f.chart.timeSignature[0]);
    const origin = grid?.originMs ?? 0;
    nearest = Math.abs(f.timeMs - (origin + Math.round((f.timeMs - origin) / barMs) * barMs));
  }
  return nearest < 170 ? Math.pow(1 - nearest / 170, 2) : 0;
}

/** 参考底图上叠加轻量动态层；不移动跑道与判定坐标。 */
function drawReactiveBackdrop(ctx: CanvasRenderingContext2D, t: Xf, f: StageFrame) {
  if (!f.motionActive || quality.tier === "low") return;
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  const energy = Math.max(0, Math.min(1, f.audioEnergy ?? 0));
  const clock = f.now * 0.001;
  const high = quality.tier === "high";
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  // 同事提供的原始运动光、远光与音波素材；只做平移/透明度，避免程序近似重画。
  const motion = loadedImage(motionLight);
  if (motion) {
    const drift = Math.sin(clock * 0.7) * 18;
    ctx.globalAlpha = 0.08 + energy * 0.12;
    ctx.drawImage(motion, X(t, 69 + drift), Y(t, 64), 1426 * t.s, 577 * t.s);
  }
  const far = loadedImage(farLight);
  if (far) {
    ctx.globalAlpha = 0.18 + energy * 0.18;
    ctx.drawImage(far, X(t, 216), Y(t, 119), 1133 * t.s, 107 * t.s);
  }
  const wave = loadedImage(waveform);
  if (wave) {
    const waveAlpha = 0.05 + energy * 0.16;
    ctx.globalAlpha = waveAlpha;
    ctx.drawImage(wave, X(t, 54), Y(t, 153), 181 * t.s, 540 * t.s);
    ctx.save();
    ctx.translate(X(t, 1510), 0); ctx.scale(-1, 1);
    ctx.drawImage(wave, 0, Y(t, 153), 181 * t.s, 540 * t.s);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // 顶部光束与地平线光晕缓慢扫动。
  const sweep = Math.sin(clock * 0.55) * 48;
  const halo = ctx.createRadialGradient(X(t, 782 + sweep), Y(t, 169), 0, X(t, 782 + sweep), Y(t, 169), 210 * t.s);
  halo.addColorStop(0, `rgba(125,226,255,${0.12 + energy * 0.12})`);
  halo.addColorStop(1, "rgba(125,226,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(X(t, 480), Y(t, 50), 604 * t.s, 260 * t.s);
  ctx.strokeStyle = `rgba(125,226,255,${0.07 + energy * 0.09})`;
  ctx.lineWidth = 3 * t.s;
  for (let i = -2; i <= 2; i++) {
    const sway = Math.sin(clock * 0.42 + i) * 35;
    ctx.beginPath();
    ctx.moveTo(X(t, 782 + sweep * 0.25), Y(t, 170));
    ctx.lineTo(X(t, 782 + i * 240 + sway), Y(t, 15));
    ctx.stroke();
  }

  // 两侧频谱能量条：固定数量、低频采样结果驱动高度，避免每帧分配数组。
  const bars = high ? 34 : 20;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < bars; i++) {
      const p = i / Math.max(1, bars - 1);
      const y = 210 + p * 410;
      const wave = 0.55 + 0.45 * Math.sin(clock * 4.2 + i * 0.83 + side);
      const amp = 10 + (18 + energy * 58) * wave * (0.45 + p * 0.55);
      const inner = side < 0 ? railX(0, y) - 25 : railX(9, y) + 25;
      ctx.strokeStyle = `rgba(104,205,255,${0.08 + energy * 0.16})`;
      ctx.lineWidth = Math.max(1, 2.2 * t.s);
      ctx.beginPath();
      ctx.moveTo(X(t, inner), Y(t, y));
      ctx.lineTo(X(t, inner + side * amp), Y(t, y - 4));
      ctx.stroke();
    }
  }

  // 山峰轮廓沿原轮廓附近缓慢漂移，保持参考构图而产生流动感。
  if (high) {
    ctx.strokeStyle = `rgba(122,196,255,${0.07 + energy * 0.08})`;
    ctx.lineWidth = 1.4 * t.s;
    for (let side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      for (let i = 0; i <= 11; i++) {
        const p = i / 11;
        const x = 782 + side * (360 + p * 420) + Math.sin(clock * 0.65 + i) * 9;
        const y = 154 + p * 130 - Math.sin(i * 1.72 + clock * 0.8) * (18 + energy * 15);
        if (i === 0) ctx.moveTo(X(t, x), Y(t, y)); else ctx.lineTo(X(t, x), Y(t, y));
      }
      ctx.stroke();
    }
  }
  ctx.restore();
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

/** 时间 → 沿实际路径长度的线性进度；缩放不参与位置计算。 */
function fallProgress(dtMs: number, speed: number, pathLength: number): number {
  return 1 - (dtMs * speed * FALL_PX_PER_MS) / Math.max(1, pathLength);
}

function placeNotes(f: StageFrame): Placed[] {
  const out: Placed[] = [];
  for (const n of f.chart.notes) {
    if (n.note === undefined) continue;
    const part = partOfNote(n.note);
    const slot = part ? slotOf(part) : null;
    if (!part || !slot) continue;
    if (slot.row === 1) {
      const startY = HORIZON_Y;
      const startX = (railX(slot.index * 2, startY) + railX(slot.index * 2 + 1, startY)) / 2;
      const endX = (railX(slot.index * 2, PAD_HIT_Y) + railX(slot.index * 2 + 1, PAD_HIT_Y)) / 2;
      const pathLength = Math.hypot(endX - startX, PAD_HIT_Y - startY);
      const progress = fallProgress(n.timeMs - f.timeMs, f.speed, pathLength);
      if (progress < 0 || progress > 1) continue;
      const y = startY + (PAD_HIT_Y - startY) * progress;
      const l = railX(slot.index * 2, y), r = railX(slot.index * 2 + 1, y);
      out.push({
        row: 1, index: slot.index, timeMs: n.timeMs, label: hatLabel(part, n.note),
        cx: (l + r) / 2, cy: y, progress, alpha: Math.min(1, progress * 8),
      });
    } else {
      const d = DIAMONDS[slot.index]; if (!d) continue;
      const spawn = TOP_SPAWNS[slot.index]; if (!spawn) continue;
      const pathLength = Math.hypot(d[0] - spawn[0], d[1] - spawn[1]);
      const progress = fallProgress(n.timeMs - f.timeMs, f.speed, pathLength);
      if (progress < 0 || progress > 1) continue;
      out.push({
        row: 0, index: slot.index, timeMs: n.timeMs, label: null,
        cx: spawn[0] + (d[0] - spawn[0]) * progress,
        cy: spawn[1] + (d[1] - spawn[1]) * progress,
        progress, alpha: Math.min(1, progress * 8),
      });
    }
  }
  return out.sort((a, b) => a.cy - b.cy);
}

function drawBar(ctx: CanvasRenderingContext2D, t: Xf, n: Placed, glow: boolean) {
  const image = loadedImage(BOTTOM_IMAGES[n.index] ?? noteB01);
  if (!image) return;
  const laneW = Math.max(2, railX(n.index * 2 + 1, n.cy) - railX(n.index * 2, n.cy));
  const imageW = laneW * 1.05 * t.s;
  const imageH = imageW * (image.naturalHeight / image.naturalWidth);
  const cx = X(t, n.cx), cy = Y(t, n.cy);
  ctx.save();
  ctx.globalAlpha = n.alpha;
  ctx.shadowColor = "rgba(255,255,255,0.45)"; ctx.shadowBlur = glow ? imageH * 0.18 : 0;
  ctx.drawImage(image, cx - imageW / 2, cy - imageH / 2, imageW, imageH);
  if (n.label && imageH > 7) {
    const fs = imageH * 0.24;
    ctx.shadowBlur = 0;
    ctx.translate(cx, cy);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `italic 500 ${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(n.label).width, max = imageW * 0.64;
    if (tw > max) ctx.scale(max / tw, 1);
    ctx.fillStyle = "rgba(12,16,24,0.9)";
    ctx.fillText(n.label, 0, fs * 0.08);
  }
  ctx.restore();
}

function drawDiamondNote(ctx: CanvasRenderingContext2D, t: Xf, n: Placed, glow: boolean) {
  const image = loadedImage(TOP_IMAGES[n.index] ?? noteT01);
  const d = DIAMONDS[n.index];
  const spawn = TOP_SPAWNS[n.index];
  if (!image || !d || !spawn) return;
  const cx = X(t, n.cx), cy = Y(t, n.cy);
  const scale = (0.36 + n.progress * 0.64) * ((d[2] * 2) / 202) * t.s;
  const imageW = image.naturalWidth * scale, imageH = image.naturalHeight * scale;
  // 原图菱形头中心在素材顶部约 17%；中心严格跟随匀速轨迹，尾光只改变外观。
  const headY = imageH * 0.17;
  // 素材尾光原本向下；旋转到音符来向，使四个音符分别沿红线角度拖尾。
  const angle = Math.atan2(spawn[1] - d[1], spawn[0] - d[0]) - Math.PI / 2;
  ctx.save();
  ctx.globalAlpha = n.alpha;
  ctx.shadowColor = "rgba(255,255,255,0.45)"; ctx.shadowBlur = glow ? 7 * t.s : 0;
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.drawImage(image, -imageW / 2, -headY, imageW, imageH);
  ctx.restore();
}

function drawBeatTargets(ctx: CanvasRenderingContext2D, t: Xf, f: StageFrame) {
  const pulse = downbeatPulse(f);
  if (pulse <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = hexToRgba(GOLD, 0.22 + pulse * 0.42);
  ctx.lineWidth = (1.2 + pulse * 1.4) * t.s;
  ctx.shadowColor = GOLD;
  ctx.shadowBlur = quality.params.glow ? 10 * pulse * t.s : 0;
  for (let i = 0; i < 5; i++) {
    const [l, r] = PAD_X[i] ?? [0, 0];
    const cx = (l + r) / 2, cy = PAD_HIT_Y, s = 1 + pulse * 0.035;
    ctx.save(); ctx.translate(X(t, cx), Y(t, cy)); ctx.scale(s, s); ctx.translate(-X(t, cx), -Y(t, cy));
    padPath(ctx, t, i); ctx.stroke(); ctx.restore();
  }
  for (const d of DIAMONDS) {
    const s = 1 + pulse * 0.055;
    ctx.save(); ctx.translate(X(t, d[0]), Y(t, d[1])); ctx.scale(s, s); ctx.translate(-X(t, d[0]), -Y(t, d[1]));
    diamondPath(ctx, t, d[0], d[1], d[2], d[3]); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
}

export function renderColumns(ctx: CanvasRenderingContext2D, w: number, h: number, f: StageFrame) {
  const glow = quality.params.glow;
  const t = transformOf(w, h);
  ctx.save();
  drawPlate(ctx, w, h, t);
  drawReactiveBackdrop(ctx, t, f);
  drawBeatTargets(ctx, t, f);
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
