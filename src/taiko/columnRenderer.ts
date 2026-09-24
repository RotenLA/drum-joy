import type { TaikoChart } from "@/shared/taikoChart";
import { PART_BY_ID, partOfNote, type PartId } from "./laneLayouts";
import { orderedColumnParts, columnIndexOfHeight } from "./fallMode";
import { quality } from "./perf";
import { drawBackground, drawHud, drawVignette, hexToRgba, stageViewport, type StageFrame } from "./stageRenderer";

const LEAD_MS = 2400;
const HIT_Y = 0.69;
const YAW_MIN = -90;
const YAW_MAX = 92;
const STICK_Y_SHIFT = 0.035;

interface ColumnGeom {
  part: PartId;
  x: number;
  width: number;
  noteW: number;
}

function columnsOf(parts: readonly PartId[], w: number): ColumnGeom[] {
  const ordered = orderedColumnParts(parts);
  const safeW = w * 0.84;
  const cell = safeW / Math.max(1, ordered.length);
  const left = (w - safeW) / 2;
  return ordered.map((part, index) => ({
    part,
    x: left + cell * (index + 0.5),
    width: cell,
    noteW: Math.max(18, Math.min(56, cell * 0.52)),
  }));
}

function drawPartGlyph(
  ctx: CanvasRenderingContext2D,
  part: PartId,
  x: number,
  y: number,
  size: number,
  intensity: number,
) {
  const color = PART_BY_ID[part].color;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = hexToRgba(color, 0.55 + intensity * 0.4);
  ctx.lineWidth = Math.max(1.2, size * 0.035);
  ctx.shadowColor = color;
  ctx.shadowBlur = quality.params.glow ? 7 + intensity * 18 : 0;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (part === "pedalHat" || part === "kick") {
    ctx.beginPath();
    ctx.moveTo(-size * 0.24, -size * 0.26);
    ctx.lineTo(size * 0.24, -size * 0.26);
    ctx.lineTo(size * 0.34, size * 0.28);
    ctx.lineTo(-size * 0.34, size * 0.28);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.24);
    ctx.lineTo(0, size * 0.2);
    ctx.stroke();
  } else if (part === "crash" || part === "hihat" || part === "ride") {
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.06, size * 0.42, size * 0.13, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, size * 0.06);
    ctx.lineTo(0, size * 0.46);
    ctx.moveTo(-size * 0.18, size * 0.46);
    ctx.lineTo(size * 0.18, size * 0.46);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.38, size * 0.24, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size * 0.26, size * 0.18);
    ctx.lineTo(-size * 0.34, size * 0.46);
    ctx.moveTo(size * 0.26, size * 0.18);
    ctx.lineTo(size * 0.34, size * 0.46);
    ctx.stroke();
  }
  ctx.restore();
}

function notePoint(
  column: ColumnGeom,
  y: number,
  big: boolean,
) {
  const color = PART_BY_ID[column.part].color;
  const width = column.noteW * (big ? 1.22 : 1);
  const height = Math.max(8, width * 0.28);
  return { x: column.x, y, rx: width / 2, ry: height / 2, color };
}

type NotePoint = ReturnType<typeof notePoint>;

function drawNote(ctx: CanvasRenderingContext2D, point: NotePoint, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = point.color;
  ctx.shadowBlur = quality.params.glow ? 14 : 0;
  ctx.fillStyle = hexToRgba(point.color, 0.7);
  ctx.strokeStyle = point.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(point.x - point.rx, point.y - point.ry, point.rx * 2, point.ry * 2, point.ry);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function visibleNotes(chart: TaikoChart, timeMs: number, speed: number) {
  const span = LEAD_MS / Math.max(0.1, speed);
  return chart.notes.filter((note) => {
    const end = note.timeMs + Math.max(0, note.holdMs ?? 0);
    return end >= timeMs - 100 && note.timeMs <= timeMs + span;
  });
}

function noteY(timeMs: number, nowMs: number, speed: number, topY: number, hitY: number): number {
  const travel = 1 - ((timeMs - nowMs) * speed) / LEAD_MS;
  return topY + (hitY - topY) * Math.max(0, Math.min(1, travel));
}

function drawHold(
  ctx: CanvasRenderingContext2D,
  point: NotePoint,
  tailY: number,
  alpha: number,
) {
  const top = Math.min(point.y, tailY);
  const bottom = Math.max(point.y, tailY);
  const halfW = point.rx * 0.72;
  const gradient = ctx.createLinearGradient(point.x, top, point.x, bottom);
  gradient.addColorStop(0, hexToRgba(point.color, 0.22));
  gradient.addColorStop(0.5, hexToRgba(point.color, 0.5));
  gradient.addColorStop(1, hexToRgba(point.color, 0.3));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.strokeStyle = hexToRgba(point.color, 0.82);
  ctx.lineWidth = 1.5;
  ctx.shadowColor = point.color;
  ctx.shadowBlur = quality.params.glow ? 9 : 0;
  ctx.beginPath();
  ctx.roundRect(point.x - halfW, top, halfW * 2, Math.max(point.ry * 2, bottom - top), halfW);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function renderColumns(ctx: CanvasRenderingContext2D, w: number, h: number, f: StageFrame) {
  drawBackground(ctx, w, h);
  const viewport = stageViewport(w, h);
  const parts = f.parts ?? [];
  const columns = columnsOf(parts, viewport.w);
  const byPart = new Map(columns.map((column) => [column.part, column]));
  const hitY = viewport.h * HIT_Y;
  ctx.save();
  ctx.translate(viewport.x, viewport.y);

  for (const column of columns) {
    const color = PART_BY_ID[column.part].color;
    const x0 = column.x - column.width * 0.43;
    ctx.fillStyle = hexToRgba(color, 0.045);
    ctx.fillRect(x0, viewport.h * 0.08, column.width * 0.86, hitY - viewport.h * 0.08);
    ctx.strokeStyle = hexToRgba(color, 0.18);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, viewport.h * 0.08);
    ctx.lineTo(x0, hitY);
    ctx.moveTo(x0 + column.width * 0.86, viewport.h * 0.08);
    ctx.lineTo(x0 + column.width * 0.86, hitY);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.52)";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "rgba(255,255,255,0.8)";
  ctx.shadowBlur = quality.params.glow ? 8 : 0;
  ctx.beginPath();
  ctx.moveTo(viewport.w * 0.06, hitY);
  ctx.lineTo(viewport.w * 0.94, hitY);
  ctx.stroke();
  ctx.shadowBlur = 0;

  const notePoints: { point: NotePoint; alpha: number }[] = [];
  if (f.showNotes !== false) {
    for (const note of visibleNotes(f.chart, f.timeMs, f.speed)) {
      if (note.note === undefined) continue;
      const part = partOfNote(note.note);
      const column = part ? byPart.get(part) : undefined;
      if (!column) continue;
      const travel = 1 - ((note.timeMs - f.timeMs) * f.speed) / LEAD_MS;
      const hold = Math.max(0, note.holdMs ?? 0);
      if ((!hold && (travel <= 0 || travel >= 1)) || (hold && note.timeMs + hold < f.timeMs - 100)) continue;
      const topY = viewport.h * 0.1;
      const y = noteY(note.timeMs, f.timeMs, f.speed, topY, hitY);
      const point = notePoint(column, y, note.big === true);
      const alpha = Math.min(1, Math.max(0.15, travel * 5));
      if (hold > 0) {
        const tailY = noteY(note.timeMs + hold, f.timeMs, f.speed, topY, hitY);
        drawHold(ctx, point, tailY, alpha);
      }
      notePoints.push({ point, alpha });
    }
    for (const item of notePoints) drawNote(ctx, item.point, item.alpha);
  }

  const glyphY = viewport.h * 0.82;
  for (const column of columns) {
    const intensity = Math.max(0, Math.min(1, ((f.flashes[column.part] ?? 0) - f.now) / 200));
    drawPartGlyph(ctx, column.part, column.x, glyphY, Math.min(column.width * 0.7, viewport.h * 0.12), intensity);
    ctx.textAlign = "center";
    ctx.fillStyle = hexToRgba(PART_BY_ID[column.part].color, 0.72);
    ctx.font = `600 ${Math.max(8, Math.min(11, column.width * 0.11))}px system-ui, sans-serif`;
    ctx.fillText(PART_BY_ID[column.part].labelEn.toUpperCase(), column.x, viewport.h * 0.95);
  }

  if (f.sticks) {
    for (const side of ["l", "r"] as const) {
      const pose = f.sticks[side];
      if (!pose) continue;
      const index = columnIndexOfHeight(pose.p, parts);
      const column = columns[index];
      if (!column) continue;
      const color = side === "l" ? "#7DE2FF" : "#FFC46B";
      const yaw = Math.max(YAW_MIN, Math.min(YAW_MAX, Number.isFinite(pose.y) ? pose.y : 0));
      const yawT = (yaw - YAW_MIN) / (YAW_MAX - YAW_MIN);
      const tipY = hitY + viewport.h * (STICK_Y_SHIFT * (yawT - 0.5) * 2);
      ctx.strokeStyle = hexToRgba(color, 0.78);
      ctx.lineWidth = Math.max(2, viewport.h * 0.005);
      ctx.shadowColor = color;
      ctx.shadowBlur = quality.params.glow ? 10 : 0;
      ctx.beginPath();
      ctx.moveTo(column.x + (side === "l" ? -1 : 1) * column.width * 0.18, viewport.h * 1.02);
      ctx.lineTo(column.x, tipY + viewport.h * 0.08);
      ctx.stroke();
    }
  }
  ctx.restore();
  drawVignette(ctx, w, h);
  ctx.save();
  ctx.translate(viewport.x, viewport.y);
  drawHud(ctx, viewport.w, viewport.h, f);
  ctx.restore();
}