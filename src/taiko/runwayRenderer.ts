/**
 * 节奏跑道模式：9（或 5）条横向轨道从右往左推进，左侧一条竖直判定线。
 * 与舞台下落共用同一份谱面、判定窗口、HUD 与 16:9 演奏区。
 */
import {
  PART_BY_ID,
  partOfNote,
  type PartId,
} from "./laneLayouts";
import {
  drawBackground,
  drawHud,
  drawVignette,
  hexToRgba,
  stageViewport,
  type StageFrame,
} from "./stageRenderer";

/** 音符从右侧入场到判定线的时间（1x 速度，毫秒） */
const LEAD_MS = 2200;
/** 判定线横向位置（相对演奏区宽） */
const HIT_X = 0.2;
/** 轨道区上下留白 */
const TOP_PAD = 0.18;
const BOT_PAD = 0.06;
const FLASH_MS = 200;

export function renderRunway(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  f: StageFrame,
) {
  drawBackground(ctx, w, h);
  const v = stageViewport(w, h);
  const parts = f.parts ?? [];
  ctx.save();
  ctx.translate(v.x, v.y);

  const top = v.h * TOP_PAD;
  const usable = v.h * (1 - TOP_PAD - BOT_PAD);
  const laneH = usable / Math.max(1, parts.length);
  const hitX = v.w * HIT_X;
  const rowOf = new Map<PartId, number>();
  parts.forEach((p, i) => rowOf.set(p, i));

  // 轨道底纹 + 左侧部件名
  ctx.save();
  ctx.textBaseline = "middle";
  parts.forEach((id, i) => {
    const y = top + laneH * i;
    const color = PART_BY_ID[id].color;
    const expiry = f.flashes[id] ?? 0;
    const intensity = Math.max(0, Math.min(1, (expiry - f.now) / FLASH_MS));
    const missExpiry = f.missFlashes?.[id] ?? 0;
    const miss = Math.max(0, Math.min(1, (missExpiry - f.now) / 240));

    const g = ctx.createLinearGradient(hitX, 0, v.w, 0);
    g.addColorStop(0, hexToRgba(color, 0.16 + 0.3 * intensity));
    g.addColorStop(1, "rgba(255,255,255,0.02)");
    ctx.fillStyle = g;
    ctx.fillRect(hitX, y + 1, v.w - hitX, laneH - 2);

    if (miss > 0) {
      ctx.fillStyle = `rgba(248,113,113,${0.22 * miss})`;
      ctx.fillRect(hitX, y + 1, v.w - hitX, laneH - 2);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hitX, y + laneH);
    ctx.lineTo(v.w, y + laneH);
    ctx.stroke();

    // 判定框（左侧命中区）
    const bx = hitX - laneH * 1.05;
    ctx.fillStyle = `rgba(10,10,14,${0.55 + 0.25 * intensity})`;
    ctx.fillRect(bx, y + 2, laneH * 1.0, laneH - 4);
    ctx.strokeStyle = hexToRgba(color, 0.6 + 0.4 * intensity);
    ctx.lineWidth = 1.5 + 2 * intensity;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8 + 20 * intensity;
    ctx.strokeRect(bx, y + 2, laneH * 1.0, laneH - 4);
    ctx.shadowBlur = 0;

    // 部件名与色点
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(bx - 14, y + laneH / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `600 ${Math.max(10, Math.round(laneH * 0.32))}px system-ui, sans-serif`;
    ctx.fillText(PART_BY_ID[id].label, bx - 24, y + laneH / 2);
  });
  ctx.restore();

  // 判定线
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(255,255,255,0.6)";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(hitX, top);
  ctx.lineTo(hitX, top + usable);
  ctx.stroke();
  ctx.restore();

  // 音符：右 → 左推进的圆角方块
  for (const n of f.chart.notes) {
    if (n.note === undefined) continue;
    const part = partOfNote(n.note);
    if (part === null) continue;
    const row = rowOf.get(part);
    if (row === undefined) continue;
    const hold = n.holdMs && n.holdMs > 0 ? n.holdMs : 0;
    const dt = (n.timeMs - f.timeMs) * f.speed;
    const dtTail = dt + hold * f.speed;
    if (dt > LEAD_MS || dtTail < -260) continue;
    const x = hitX + ((v.w - hitX) * dt) / LEAD_MS;
    const xTail = hitX + ((v.w - hitX) * Math.min(dtTail, LEAD_MS)) / LEAD_MS;
    const y = top + laneH * row + laneH / 2;
    const color = PART_BY_ID[part].color;
    const nh = laneH * (n.big ? 0.74 : 0.58);
    const nw = nh * 1.5;
    const alpha = dtTail < 0 ? Math.max(0, 1 + dtTail / 260) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = hexToRgba(color, 0.38);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (hold) {
      // 长音符：从头部一直拖到尾端的色带
      const bh = nh * 0.6;
      ctx.beginPath();
      ctx.roundRect(Math.min(x, xTail), y - bh / 2, Math.abs(xTail - x), bh, bh * 0.3);
      ctx.fillStyle = hexToRgba(color, 0.26);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hexToRgba(color, 0.38);
    }
    if (dt > -260) {
      ctx.beginPath();
      ctx.roundRect(x - nw / 2, y - nh / 2, nw, nh, nh * 0.28);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
  drawVignette(ctx, w, h);
  ctx.save();
  ctx.translate(v.x, v.y);
  drawHud(ctx, v.w, v.h, f);
  ctx.restore();
}
