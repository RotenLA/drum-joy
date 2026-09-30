/**
 * 横排下落式渲染器。
 * 五条跑道分别绘制；底排音符沿所属跑道投影，上排使用独立的竖立菱形目标。
 */
import { PART_BY_ID, partOfNote, type PartId } from "./laneLayouts";
import { quality } from "./perf";
import { drawHud, hexToRgba, stageViewport, type StageFrame } from "./stageRenderer";

const LEAD_MS = 2200;
const FLASH_MS = 200;
const ACCENT = "#f6c928";
const NOTE_ORANGE = "#ff9d24";
const RAIL = "#55dff0";
const SKY = "#07101e";

const BOTTOM_SLOTS: readonly (PartId | null)[] = [null, "hihat", "snare", "kick", "floorTom"];
const TOP_SLOTS: readonly PartId[] = ["crash", "highTom", "midTom", "ride"];
const FOOT_SLOTS = new Set([1, 3]);

interface Slot { row: 0 | 1; index: number }
interface Point { x: number; y: number }
interface Quad { farLeft: Point; farRight: Point; nearRight: Point; nearLeft: Point; cx: number; cy: number; width: number; height: number }
interface Geom {
  w: number; h: number; cx: number; horizonY: number; nearY: number;
  farHalf: number; nearHalf: number; topDepth: number; bottomDepth: number;
}
interface StandingTarget { center: Point; width: number; height: number; skew: number; depth: number }
interface Placed {
  part: PartId; row: 0 | 1; quad: Quad; color: string; label: string | null;
  timeMs: number; tailQuad: Quad | null;
}

const LANE_CENTERS = [-0.8, -0.4, 0, 0.4, 0.8] as const;
const LANE_WIDTH = 0.36;
const TOP_U = [-0.82, -0.22, 0.22, 0.78] as const;
const TOP_DEPTH = [0.505, 0.47, 0.47, 0.505] as const;

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

function geomOf(w: number, h: number): Geom {
  return {
    w, h, cx: w * 0.5,
    horizonY: h * 0.238,
    nearY: h * 0.94,
    farHalf: w * 0.054,
    nearHalf: Math.min(w * 0.292, h * 0.61),
    topDepth: 0.49,
    bottomDepth: 0.865,
  };
}

/** u: -1..1 across the road; depth: far entrance 0, player 1. */
function groundPoint(g: Geom, u: number, depth: number): Point {
  const d = Math.max(0, Math.min(1.05, depth));
  const spread = g.farHalf + (g.nearHalf - g.farHalf) * Math.pow(d, 1.02);
  const y = g.horizonY + (g.nearY - g.horizonY) * Math.pow(d, 1.22);
  return { x: g.cx + u * spread, y };
}

function laneCenter(index: number): number { return LANE_CENTERS[index] ?? 0; }

function groundQuad(g: Geom, centerU: number, widthU: number, centerDepth: number, depthSize: number): Quad {
  const farD = Math.max(0.006, centerDepth - depthSize * 0.5);
  const nearD = Math.min(1.045, centerDepth + depthSize * 0.5);
  const farLeft = groundPoint(g, centerU - widthU * 0.5, farD);
  const farRight = groundPoint(g, centerU + widthU * 0.5, farD);
  const nearRight = groundPoint(g, centerU + widthU * 0.5, nearD);
  const nearLeft = groundPoint(g, centerU - widthU * 0.5, nearD);
  return {
    farLeft, farRight, nearRight, nearLeft,
    cx: (farLeft.x + farRight.x + nearRight.x + nearLeft.x) / 4,
    cy: (farLeft.y + farRight.y + nearRight.y + nearLeft.y) / 4,
    width: ((farRight.x - farLeft.x) + (nearRight.x - nearLeft.x)) / 2,
    height: nearLeft.y - farLeft.y,
  };
}

function quadPath(ctx: CanvasRenderingContext2D, q: Quad) {
  ctx.beginPath();
  ctx.moveTo(q.farLeft.x, q.farLeft.y);
  ctx.lineTo(q.farRight.x, q.farRight.y);
  ctx.lineTo(q.nearRight.x, q.nearRight.y);
  ctx.lineTo(q.nearLeft.x, q.nearLeft.y);
  ctx.closePath();
}

function drawGlowLine(ctx: CanvasRenderingContext2D, a: Point, b: Point, alpha: number, width: number, glow: boolean) {
  ctx.save();
  ctx.strokeStyle = hexToRgba(RAIL, alpha);
  ctx.lineWidth = width;
  ctx.shadowColor = RAIL;
  ctx.shadowBlur = glow ? width * 3.2 : 0;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.restore();
}

function drawMountains(ctx: CanvasRenderingContext2D, g: Geom, glow: boolean) {
  const ridges = [
    [0,.10,.08,.18,.16,.13,.24,.25,.33,.19,.42,.30,.51,.20,.60,.27,.70,.16,.80,.22,.90,.12,1,.17],
    [0,.06,.10,.12,.20,.08,.30,.17,.40,.11,.50,.20,.61,.12,.72,.16,.84,.08,.94,.13,1.04,.07],
  ];
  for (const side of [-1, 1] as const) {
    for (let layer = 0; layer < ridges.length; layer++) {
      const values = ridges[layer] ?? [];
      const inner = groundPoint(g, side * (1.07 + layer * 0.03), 0.025 + layer * 0.02);
      const outerX = side < 0 ? 0 : g.w;
      const span = Math.abs(outerX - inner.x);
      const baseAt = (t: number) => g.horizonY + g.h * (0.015 + t * 0.19);
      const xAt = (t: number) => inner.x + side * span * t;
      const yAt = (t: number, peak: number) => baseAt(t) - peak * g.h * (0.32 + t * 0.08);
      ctx.save();
      ctx.strokeStyle = hexToRgba(RAIL, layer === 0 ? 0.32 : 0.16);
      ctx.lineWidth = layer === 0 ? 1.25 : 0.8;
      ctx.shadowColor = RAIL; ctx.shadowBlur = glow ? 4 : 0;
      ctx.beginPath();
      for (let i = 0; i < values.length; i += 2) {
        const t = values[i] ?? 0, peak = values[i + 1] ?? 0;
        if (i === 0) ctx.moveTo(xAt(t), yAt(t, peak)); else ctx.lineTo(xAt(t), yAt(t, peak));
      }
      ctx.stroke();
      for (let i = 0; i + 3 < values.length; i += 2) {
        const ta = values[i] ?? 0, pa = values[i + 1] ?? 0;
        const tb = values[i + 2] ?? 0, pb = values[i + 3] ?? 0;
        const mid = (ta + tb) * 0.5;
        ctx.beginPath();
        ctx.moveTo(xAt(ta), yAt(ta, pa));
        ctx.lineTo(xAt(mid), baseAt(mid));
        ctx.lineTo(xAt(tb), yAt(tb, pb));
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

function drawLane(ctx: CanvasRenderingContext2D, g: Geom, index: number, glow: boolean) {
  const center = laneCenter(index);
  const q = groundQuad(g, center, LANE_WIDTH, 0.515, 1.018);
  const floor = ctx.createLinearGradient(0, g.horizonY, 0, g.nearY);
  floor.addColorStop(0, "rgba(8,30,48,0.28)");
  floor.addColorStop(1, "rgba(2,10,21,0.78)");
  ctx.save(); quadPath(ctx, q); ctx.fillStyle = floor; ctx.fill(); ctx.restore();

  for (const edge of [-1, 1] as const) {
    const u = center + edge * LANE_WIDTH * 0.5;
    drawGlowLine(ctx, groundPoint(g, u, 0.004), groundPoint(g, u, 1.025), 0.65, 1.15, glow);
    const inset = u - edge * 0.012;
    drawGlowLine(ctx, groundPoint(g, inset, 0.035), groundPoint(g, inset, 1.01), 0.2, 0.7, false);
  }
}

function drawScene(ctx: CanvasRenderingContext2D, g: Geom, now: number, glow: boolean) {
  const sky = ctx.createLinearGradient(0, 0, 0, g.h);
  sky.addColorStop(0, "rgba(5,11,24,0.93)");
  sky.addColorStop(0.52, "rgba(7,17,34,0.90)");
  sky.addColorStop(1, "rgba(2,7,15,0.97)");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, g.w, g.h);

  const halo = ctx.createLinearGradient(g.cx - g.w * 0.12, 0, g.cx + g.w * 0.12, 0);
  halo.addColorStop(0, "rgba(0,0,0,0)");
  halo.addColorStop(0.38, hexToRgba(RAIL, 0.04));
  halo.addColorStop(0.5, hexToRgba(RAIL, 0.34));
  halo.addColorStop(0.62, hexToRgba(RAIL, 0.04));
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save(); ctx.fillStyle = halo; ctx.fillRect(g.cx-g.w*.13,g.horizonY-g.h*.018,g.w*.26,g.h*.04); ctx.restore();

  drawMountains(ctx, g, glow);
  for (let i = 0; i < 5; i++) drawLane(ctx, g, i, glow);

  const flow = (now / 5000) % 0.03;
  for (let i = 0; i < 43; i++) {
    const d = Math.min(1.02, Math.pow((i + 1) / 43, 1.58) + flow * (i / 43));
    const leftInner = groundPoint(g, -1.08, d), leftOuter = groundPoint(g, -1.43, d);
    const rightInner = groundPoint(g, 1.08, d), rightOuter = groundPoint(g, 1.43, d);
    const alpha = 0.08 + d * 0.19;
    drawGlowLine(ctx, leftInner, { x: leftOuter.x, y: leftInner.y }, alpha, 0.85, false);
    drawGlowLine(ctx, rightInner, { x: rightOuter.x, y: rightInner.y }, alpha, 0.85, false);
  }
}

function topTarget(g: Geom, index: number): StandingTarget {
  const depth = TOP_DEPTH[index] ?? g.topDepth;
  const floor = groundPoint(g, TOP_U[index] ?? 0, depth);
  const scale = 0.72 + depth * 0.28;
  return {
    center: { x: floor.x, y: floor.y - g.h * (index === 0 || index === 3 ? 0.016 : 0.027) },
    width: g.w * 0.037 * scale,
    height: g.h * 0.085 * scale,
    skew: (index - 1.5) * g.w * 0.0028,
    depth,
  };
}

function diamondPoints(t: StandingTarget, lift = 0): [Point, Point, Point, Point] {
  const cx = t.center.x, cy = t.center.y - lift;
  return [
    { x: cx + t.skew, y: cy - t.height * 0.5 },
    { x: cx + t.width * 0.5, y: cy },
    { x: cx - t.skew, y: cy + t.height * 0.5 },
    { x: cx - t.width * 0.5, y: cy },
  ];
}

function diamondPath(ctx: CanvasRenderingContext2D, points: readonly Point[]) {
  const first = points[0]; if (!first) return;
  ctx.beginPath(); ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) { const p = points[i]; if (p) ctx.lineTo(p.x, p.y); }
  ctx.closePath();
}

function drawTopRow(ctx: CanvasRenderingContext2D, g: Geom, f: StageFrame, glow: boolean) {
  const bandLeft = groundPoint(g, -1.04, g.topDepth);
  const bandRight = groundPoint(g, 1.04, g.topDepth);
  ctx.save(); ctx.strokeStyle = hexToRgba(ACCENT, 0.62); ctx.lineWidth = 1.25;
  ctx.shadowColor = ACCENT; ctx.shadowBlur = glow ? 5 : 0;
  ctx.beginPath(); ctx.moveTo(bandLeft.x, bandLeft.y); ctx.lineTo(bandRight.x, bandRight.y); ctx.stroke(); ctx.restore();

  for (let i = 0; i < TOP_SLOTS.length; i++) {
    const part = TOP_SLOTS[i]; if (!part) continue;
    const hit = Math.max(0, Math.min(1, ((f.flashes[part] ?? 0) - f.now) / FLASH_MS));
    const miss = Math.max(0, Math.min(1, ((f.missFlashes?.[part] ?? 0) - f.now) / 240));
    const target = topTarget(g, i);
    const rear = diamondPoints(target, g.h * 0.008);
    const front = diamondPoints(target);
    ctx.save();
    ctx.strokeStyle = miss ? "rgba(248,113,113,0.95)" : hexToRgba(ACCENT, 0.42 + hit * 0.48);
    ctx.fillStyle = hit ? hexToRgba(PART_BY_ID[part].color, 0.25 + hit * 0.48) : "rgba(8,14,24,0.2)";
    ctx.lineWidth = 1.25; ctx.shadowColor = hit ? PART_BY_ID[part].color : ACCENT; ctx.shadowBlur = glow ? 5 + hit * 10 : 0;
    diamondPath(ctx, rear); ctx.stroke();
    for (let p = 0; p < 4; p++) {
      const a = rear[p], b = front[p]; if (!a || !b) continue;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    diamondPath(ctx, front); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

function drawChevron(ctx: CanvasRenderingContext2D, q: Quad, direction: -1 | 1, offset: number) {
  const centerX = q.cx + direction * q.width * offset;
  const sy = Math.max(2, q.height * 0.31), sx = q.width * 0.075;
  ctx.beginPath();
  ctx.moveTo(centerX - direction * sx, q.cy - sy);
  ctx.lineTo(centerX, q.cy);
  ctx.lineTo(centerX - direction * sx, q.cy + sy);
  ctx.stroke();
}

function drawBottomRow(ctx: CanvasRenderingContext2D, g: Geom, f: StageFrame, glow: boolean) {
  for (let i = 0; i < 5; i++) {
    const part = BOTTOM_SLOTS[i];
    const expiry = part ? Math.max(f.flashes[part] ?? 0, part === "hihat" ? f.flashes["pedalHat"] ?? 0 : 0) : 0;
    const hit = Math.max(0, Math.min(1, (expiry - f.now) / FLASH_MS));
    const q = groundQuad(g, laneCenter(i), LANE_WIDTH * 0.94, g.bottomDepth, 0.052);
    ctx.save(); quadPath(ctx, q); ctx.clip();
    ctx.fillStyle = hit ? hexToRgba(ACCENT, 0.25 + hit * 0.45) : "rgba(5,12,20,0.82)";
    ctx.fillRect(q.farLeft.x, q.farLeft.y, q.nearRight.x-q.farLeft.x, q.nearRight.y-q.farLeft.y);
    ctx.strokeStyle = hexToRgba(ACCENT, 0.78 + hit * 0.2); ctx.lineWidth = Math.max(1.2, g.h*0.0018);
    ctx.shadowColor = ACCENT; ctx.shadowBlur = glow ? 5 + hit*10 : 0;
    for (const dir of [-1,1] as const) for (const off of [0.08,0.19,0.30]) drawChevron(ctx,q,dir,off);
    ctx.restore();
    ctx.save(); quadPath(ctx,q); ctx.strokeStyle=hexToRgba(ACCENT,0.92); ctx.lineWidth=1.25; ctx.shadowColor=ACCENT; ctx.shadowBlur=glow?6:0; ctx.stroke(); ctx.restore();

    if (FOOT_SLOTS.has(i)) {
      const p = groundPoint(g, laneCenter(i), 0.97);
      ctx.save(); ctx.fillStyle=hexToRgba(ACCENT,0.27); ctx.translate(p.x,p.y); ctx.rotate(i===1?-0.07:0.07);
      ctx.beginPath(); ctx.ellipse(0,0,g.w*0.008,g.h*0.021,0,0,Math.PI*2); ctx.fill();
      for(let t=0;t<4;t++){ctx.beginPath();ctx.arc((t-1.5)*g.w*0.0045,-g.h*0.022,g.w*0.0019,0,Math.PI*2);ctx.fill();}
      ctx.restore();
    }
  }
}

function bottomNoteQuad(g: Geom, slot: Slot, depth: number): Quad {
  return groundQuad(g, laneCenter(slot.index), LANE_WIDTH * 0.79, depth, 0.034);
}

function topNoteQuad(g: Geom, slot: Slot, progress: number): Quad {
  const target = topTarget(g, slot.index);
  const start = groundPoint(g, TOP_U[slot.index] ?? 0, 0.025);
  const eased = Math.pow(Math.max(0, Math.min(1, progress)), 1.36);
  const cx = start.x + (target.center.x - start.x) * eased;
  const cy = start.y + (target.center.y - start.y) * eased;
  const width = Math.max(3, target.width * (0.12 + eased * 0.88));
  const height = Math.max(2, target.height * (0.12 + eased * 0.88));
  const farLeft = { x: cx - width * 0.5, y: cy };
  const farRight = { x: cx, y: cy - height * 0.5 };
  const nearRight = { x: cx + width * 0.5, y: cy };
  const nearLeft = { x: cx, y: cy + height * 0.5 };
  return { farLeft, farRight, nearRight, nearLeft, cx, cy, width, height };
}

function placeNotes(g: Geom, f: StageFrame): Placed[] {
  const out: Placed[]=[];
  for(const n of f.chart.notes){
    if(n.note===undefined) continue;
    const part=partOfNote(n.note), slot=part?slotOf(part):null;
    if(!part||!slot) continue;
    const linear=1-((n.timeMs-f.timeMs)*f.speed)/LEAD_MS;
    const tailLinear=n.holdMs?1-((n.timeMs+n.holdMs-f.timeMs)*f.speed)/LEAD_MS:linear;
    if(linear<=0.012||tailLinear>=1.025) continue;
    const progress=Math.max(0.012,Math.min(1,linear));
    const tailProgress=Math.max(0.012,Math.min(1,tailLinear));
    const target=slot.row===0?g.topDepth:g.bottomDepth;
    const depth=(v:number)=>target*Math.pow(v,1.43);
    const quad=slot.row===0?topNoteQuad(g,slot,progress):bottomNoteQuad(g,slot,depth(progress));
    const tailQuad=n.holdMs?(slot.row===0?topNoteQuad(g,slot,tailProgress):bottomNoteQuad(g,slot,depth(tailProgress))):null;
    out.push({part,row:slot.row,quad,color:PART_BY_ID[part].color,label:hatLabel(part,n.note),timeMs:n.timeMs,tailQuad});
  }
  return out.sort((a,b)=>a.quad.cy-b.quad.cy);
}

function drawChordLinks(ctx:CanvasRenderingContext2D, placed:Placed[], glow:boolean){
  const groups=new Map<number,Placed[]>();
  for(const p of placed){const k=Math.round(p.timeMs/15);const a=groups.get(k);if(a)a.push(p);else groups.set(k,[p]);}
  for(const group of groups.values()){
    const tops=group.filter(x=>x.row===0), bottoms=group.filter(x=>x.row===1);
    for(const a of tops)for(const b of bottoms){
      const dx=b.quad.cx-a.quad.cx,dy=b.quad.cy-a.quad.cy,len=Math.max(1,Math.hypot(dx,dy));
      const aPad=Math.min(a.quad.width,a.quad.height)*0.45,bPad=Math.min(b.quad.width,b.quad.height)*0.45;
      const p1={x:a.quad.cx+dx/len*aPad,y:a.quad.cy+dy/len*aPad},p2={x:b.quad.cx-dx/len*bPad,y:b.quad.cy-dy/len*bPad};
      const grad=ctx.createLinearGradient(p1.x,p1.y,p2.x,p2.y);grad.addColorStop(0,hexToRgba(a.color,.43));grad.addColorStop(1,hexToRgba(b.color,.43));
      ctx.save();ctx.strokeStyle=grad;ctx.lineWidth=1.25;ctx.shadowColor=a.color;ctx.shadowBlur=glow?4:0;ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();ctx.restore();
    }
  }
}

function drawNote(ctx:CanvasRenderingContext2D,n:Placed,glow:boolean){
  const q=n.quad;
  if(n.tailQuad){const t=n.tailQuad;ctx.save();ctx.beginPath();ctx.moveTo(t.farLeft.x,t.farLeft.y);ctx.lineTo(t.farRight.x,t.farRight.y);ctx.lineTo(q.nearRight.x,q.nearRight.y);ctx.lineTo(q.nearLeft.x,q.nearLeft.y);ctx.closePath();ctx.fillStyle=hexToRgba(n.color,.16);ctx.fill();ctx.restore();}
  ctx.save();quadPath(ctx,q);
  const base=n.label?NOTE_ORANGE:n.color;
  const grad=ctx.createLinearGradient(0,q.farLeft.y,0,q.nearLeft.y);grad.addColorStop(0,hexToRgba(base,.98));grad.addColorStop(1,hexToRgba(base,.72));
  ctx.fillStyle=grad;ctx.shadowColor=base;ctx.shadowBlur=glow?7:0;ctx.fill();ctx.strokeStyle="rgba(255,234,178,.88)";ctx.lineWidth=.9;ctx.stroke();ctx.restore();
  if(n.label&&q.height>4){
    const fs=Math.max(7,Math.min(19,q.height*0.82));ctx.save();ctx.translate(q.cx,q.cy);ctx.textAlign="center";ctx.textBaseline="middle";ctx.font=`700 ${fs}px system-ui, sans-serif`;
    const tw=ctx.measureText(n.label).width,max=q.width*.82;if(tw>max)ctx.scale(max/tw,1);
    ctx.strokeStyle="rgba(70,34,4,.72)";ctx.lineWidth=Math.max(1.2,fs*.13);ctx.strokeText(n.label,0,0);ctx.fillStyle="rgba(255,245,220,.98)";ctx.fillText(n.label,0,0);ctx.restore();
  }
}

export function renderColumns(ctx:CanvasRenderingContext2D,w:number,h:number,f:StageFrame){
  const glow=quality.params.glow,v=stageViewport(w,h);
  ctx.save();ctx.fillStyle=SKY;ctx.fillRect(0,0,w,h);ctx.translate(v.x,v.y);ctx.beginPath();ctx.rect(0,0,v.w,v.h);ctx.clip();
  const g=geomOf(v.w,v.h);drawScene(ctx,g,f.now,glow);drawTopRow(ctx,g,f,glow);drawBottomRow(ctx,g,f,glow);
  if(f.showNotes!==false){const placed=placeNotes(g,f);drawChordLinks(ctx,placed,glow);for(const n of placed)drawNote(ctx,n,glow);}
  ctx.restore();ctx.save();ctx.translate(v.x,v.y);drawHud(ctx,v.w,v.h,f);ctx.restore();
}
