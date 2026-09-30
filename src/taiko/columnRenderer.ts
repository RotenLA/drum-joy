/**
 * 横排下落式渲染器。
 * 所有跑道、判定点与音符共用一套地面投影，避免屏幕平贴元素破坏透视。
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
interface Placed {
  part: PartId; row: 0 | 1; quad: Quad; color: string; label: string | null;
  timeMs: number; tailQuad: Quad | null;
}

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
    horizonY: h * 0.205,
    nearY: h * 0.905,
    farHalf: w * 0.027,
    nearHalf: Math.min(w * 0.315, h * 0.64),
    topDepth: 0.48,
    bottomDepth: 0.91,
  };
}

/** u: -1..1 across the complete five-lane road; depth: horizon 0, player 1. */
function groundPoint(g: Geom, u: number, depth: number): Point {
  const d = Math.max(0, Math.min(1.06, depth));
  const spread = g.farHalf + (g.nearHalf - g.farHalf) * Math.pow(d, 1.08);
  const y = g.horizonY + (g.nearY - g.horizonY) * Math.pow(d, 1.28);
  return { x: g.cx + u * spread, y };
}

function laneU(index: number): number { return -1 + (index / 5) * 2; }
function laneCenterU(index: number): number { return -1 + ((index + 0.5) / 5) * 2; }

function groundQuad(g: Geom, centerU: number, widthU: number, centerDepth: number, depthSize: number): Quad {
  const farD = Math.max(0.008, centerDepth - depthSize * 0.5);
  const nearD = Math.min(1.055, centerDepth + depthSize * 0.5);
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
  ctx.shadowBlur = glow ? width * 3.5 : 0;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.restore();
}

function drawMountains(ctx: CanvasRenderingContext2D, g: Geom, glow: boolean) {
  const profiles = [
    [0.00,0.66, 0.08,0.48, 0.16,0.60, 0.24,0.38, 0.33,0.55, 0.43,0.31, 0.53,0.47, 0.64,0.24, 0.74,0.36, 0.84,0.17, 0.94,0.29, 1.04,0.12],
    [0.00,0.49, 0.10,0.36, 0.21,0.45, 0.32,0.25, 0.43,0.39, 0.55,0.18, 0.66,0.30, 0.79,0.12, 0.91,0.23, 1.04,0.08],
  ];
  for (let side = -1; side <= 1; side += 2) {
    for (let layer = 0; layer < profiles.length; layer++) {
      const values = profiles[layer]!;
      const inner = groundPoint(g, side * 1.08, 0.04 + layer * 0.03);
      const outerX = side < 0 ? 0 : g.w;
      const span = Math.abs(outerX - inner.x);
      ctx.save();
      ctx.strokeStyle = hexToRgba(RAIL, layer === 0 ? 0.35 : 0.2);
      ctx.lineWidth = layer === 0 ? 1.35 : 1;
      ctx.shadowColor = RAIL;
      ctx.shadowBlur = glow ? 5 : 0;
      ctx.beginPath();
      for (let i = 0; i < values.length; i += 2) {
        const along = values[i]!;
        const peak = values[i + 1]!;
        const x = inner.x + side * span * along;
        const base = g.horizonY + g.h * (0.025 + along * 0.32);
        const y = base - peak * g.h * (0.25 + along * 0.12);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // triangulated facets create the reference's wireframe mountain volume
      for (let i = 0; i + 4 < values.length; i += 4) {
        const a = values[i]!, ah = values[i + 1]!;
        const b = values[i + 2]!, bh = values[i + 3]!;
        const c = values[i + 4]!, ch = values[i + 5]!;
        const px = (t: number) => inner.x + side * span * t;
        const py = (t: number, ph: number) => g.horizonY + g.h * (0.025 + t * 0.32) - ph * g.h * (0.25 + t * 0.12);
        ctx.beginPath();
        ctx.moveTo(px(a), py(a, ah));
        ctx.lineTo(px(b), g.horizonY + g.h * (0.03 + b * 0.32));
        ctx.lineTo(px(c), py(c, ch));
        ctx.moveTo(px(b), py(b, bh));
        ctx.lineTo(px(b), g.horizonY + g.h * (0.03 + b * 0.32));
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

function drawScene(ctx: CanvasRenderingContext2D, g: Geom, now: number, glow: boolean) {
  const sky = ctx.createLinearGradient(0, 0, 0, g.h);
  sky.addColorStop(0, "rgba(5,11,24,0.92)");
  sky.addColorStop(0.48, "rgba(8,18,37,0.89)");
  sky.addColorStop(1, "rgba(3,8,17,0.95)");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, g.w, g.h);

  const halo = ctx.createRadialGradient(g.cx, g.horizonY, 0, g.cx, g.horizonY, g.w * 0.19);
  halo.addColorStop(0, hexToRgba(RAIL, 0.48));
  halo.addColorStop(0.08, hexToRgba(RAIL, 0.18));
  halo.addColorStop(0.5, hexToRgba(RAIL, 0.035));
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo; ctx.fillRect(0, 0, g.w, g.h * 0.52);

  drawMountains(ctx, g, glow);

  // dark road slab
  const roadFarL = groundPoint(g, -1, 0);
  const roadFarR = groundPoint(g, 1, 0);
  const roadNearR = groundPoint(g, 1, 1.06);
  const roadNearL = groundPoint(g, -1, 1.06);
  const floor = ctx.createLinearGradient(0, g.horizonY, 0, g.nearY);
  floor.addColorStop(0, "rgba(8,28,47,0.25)"); floor.addColorStop(1, "rgba(3,12,24,0.88)");
  ctx.fillStyle = floor;
  ctx.beginPath(); ctx.moveTo(roadFarL.x, roadFarL.y); ctx.lineTo(roadFarR.x, roadFarR.y);
  ctx.lineTo(roadNearR.x, roadNearR.y); ctx.lineTo(roadNearL.x, roadNearL.y); ctx.closePath(); ctx.fill();

  // side synthwave steps, spacing increases toward player
  const flow = (now / 4200) % 0.035;
  for (let i = 0; i < 38; i++) {
    const d = Math.min(1.03, Math.pow((i + 1) / 38, 1.68) + flow * (i / 38));
    const y = groundPoint(g, 0, d).y;
    const l0 = groundPoint(g, -1.03, d), l1 = groundPoint(g, -1.48, d);
    const r0 = groundPoint(g, 1.03, d), r1 = groundPoint(g, 1.48, d);
    const alpha = 0.1 + d * 0.22;
    drawGlowLine(ctx, l0, { x: l1.x, y }, alpha, 1, false);
    drawGlowLine(ctx, r0, { x: r1.x, y }, alpha, 1, false);
  }

  // six readable double-edge lane separators
  for (let i = 0; i <= 5; i++) {
    const u = laneU(i);
    const far = groundPoint(g, u, 0.005);
    const near = groundPoint(g, u, 1.06);
    drawGlowLine(ctx, far, near, i === 0 || i === 5 ? 0.66 : 0.52, i === 0 || i === 5 ? 1.5 : 1.15, glow);
    const offset = (i === 0 ? -1 : i === 5 ? 1 : (i < 2.5 ? -1 : 1)) * 0.008;
    drawGlowLine(ctx, groundPoint(g, u + offset, 0.04), groundPoint(g, u + offset, 1.04), 0.22, 0.8, false);
  }
}

function drawProjectedBand(ctx: CanvasRenderingContext2D, g: Geom, depth: number, color: string, alpha: number, glow: boolean) {
  const a = groundPoint(g, -1.08, depth), b = groundPoint(g, 1.08, depth);
  ctx.save(); ctx.strokeStyle = hexToRgba(color, alpha); ctx.lineWidth = 1.5;
  ctx.shadowColor = color; ctx.shadowBlur = glow ? 7 : 0;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
}

function drawTopRow(ctx: CanvasRenderingContext2D, g: Geom, f: StageFrame, glow: boolean) {
  drawProjectedBand(ctx, g, g.topDepth, ACCENT, 0.63, glow);
  const us = [-0.78, -0.26, 0.26, 0.78];
  for (let i = 0; i < TOP_SLOTS.length; i++) {
    const part = TOP_SLOTS[i]!;
    const hit = Math.max(0, Math.min(1, ((f.flashes[part] ?? 0) - f.now) / FLASH_MS));
    const miss = Math.max(0, Math.min(1, ((f.missFlashes?.[part] ?? 0) - f.now) / 240));
    const q = groundQuad(g, us[i]!, 0.19, g.topDepth, 0.075);
    ctx.save(); quadPath(ctx, q);
    ctx.fillStyle = hit ? hexToRgba(PART_BY_ID[part].color, 0.25 + hit * 0.5) : "rgba(7,14,24,0.34)"; ctx.fill();
    ctx.strokeStyle = miss ? "rgba(248,113,113,0.95)" : hexToRgba(ACCENT, 0.78 + hit * 0.2);
    ctx.lineWidth = 1.45; ctx.shadowColor = hit ? PART_BY_ID[part].color : ACCENT; ctx.shadowBlur = glow ? 6 + hit * 13 : 0; ctx.stroke(); ctx.restore();
  }
}

function drawChevron(ctx: CanvasRenderingContext2D, q: Quad, direction: -1 | 1, offset: number) {
  const lerp = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t });
  const leftMid = lerp(q.farLeft, q.nearLeft, 0.5), rightMid = lerp(q.farRight, q.nearRight, 0.5);
  const center = lerp(leftMid, rightMid, 0.5 + direction * offset);
  const sx = q.width * 0.09, sy = Math.max(2, q.height * 0.27);
  ctx.beginPath(); ctx.moveTo(center.x - direction*sx, center.y-sy); ctx.lineTo(center.x, center.y); ctx.lineTo(center.x-direction*sx, center.y+sy); ctx.stroke();
}

function drawBottomRow(ctx: CanvasRenderingContext2D, g: Geom, f: StageFrame, glow: boolean) {
  for (let i = 0; i < 5; i++) {
    const part = BOTTOM_SLOTS[i];
    const expiry = part ? Math.max(f.flashes[part] ?? 0, part === "hihat" ? f.flashes["pedalHat"] ?? 0 : 0) : 0;
    const hit = Math.max(0, Math.min(1, (expiry - f.now) / FLASH_MS));
    const q = groundQuad(g, laneCenterU(i), 0.37, g.bottomDepth, 0.075);
    ctx.save(); quadPath(ctx, q); ctx.clip();
    ctx.fillStyle = hit ? hexToRgba(ACCENT, 0.18 + hit * 0.42) : "rgba(7,14,22,0.76)"; ctx.fillRect(q.farLeft.x, q.farLeft.y, q.nearRight.x-q.farLeft.x, q.nearRight.y-q.farLeft.y);
    ctx.strokeStyle = hexToRgba(ACCENT, 0.72 + hit * 0.25); ctx.lineWidth = Math.max(1.4, g.h*0.0022); ctx.shadowColor = ACCENT; ctx.shadowBlur = glow ? 6+hit*13 : 0;
    for (const dir of [-1,1] as const) for (const off of [0.09,0.18,0.27]) drawChevron(ctx,q,dir,off);
    ctx.restore();
    ctx.save(); quadPath(ctx,q); ctx.strokeStyle=hexToRgba(ACCENT,0.92); ctx.lineWidth=1.5; ctx.shadowColor=ACCENT; ctx.shadowBlur=glow?7:0; ctx.stroke(); ctx.restore();

    if (FOOT_SLOTS.has(i)) {
      const p = groundPoint(g, laneCenterU(i), 1.01);
      ctx.save(); ctx.fillStyle=hexToRgba(ACCENT,0.3); ctx.translate(p.x,p.y); ctx.rotate(i===1?-0.08:0.08);
      ctx.beginPath(); ctx.ellipse(0,0,g.w*0.011,g.h*0.025,0,0,Math.PI*2); ctx.fill();
      for(let t=0;t<4;t++){ctx.beginPath();ctx.arc((t-1.5)*g.w*0.006,-g.h*0.027,g.w*0.0025,0,Math.PI*2);ctx.fill();}
      ctx.restore();
    }
  }
}

function noteQuad(g: Geom, slot: Slot, depth: number): Quad {
  const centerU = slot.row === 0 ? [-0.78,-0.26,0.26,0.78][slot.index]! : laneCenterU(slot.index);
  const widthU = slot.row === 0 ? 0.18 : 0.31;
  const depthSize = slot.row === 0 ? 0.055 : 0.046;
  return groundQuad(g, centerU, widthU, depth, depthSize);
}

function placeNotes(g: Geom, f: StageFrame): Placed[] {
  const out: Placed[]=[];
  for(const n of f.chart.notes){
    if(n.note===undefined) continue;
    const part=partOfNote(n.note), slot=part?slotOf(part):null;
    if(!part||!slot) continue;
    const linear=1-((n.timeMs-f.timeMs)*f.speed)/LEAD_MS;
    const tailLinear=n.holdMs?1-((n.timeMs+n.holdMs-f.timeMs)*f.speed)/LEAD_MS:linear;
    if(linear<=0.015||tailLinear>=1.02) continue;
    const target=slot.row===0?g.topDepth:g.bottomDepth;
    const depth=(v:number)=>target*Math.pow(Math.max(0.012,Math.min(1,v)),1.52);
    out.push({part,row:slot.row,quad:noteQuad(g,slot,depth(linear)),color:PART_BY_ID[part].color,label:hatLabel(part,n.note),timeMs:n.timeMs,tailQuad:n.holdMs?noteQuad(g,slot,depth(tailLinear)):null});
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
      const aPad=Math.min(a.quad.width,a.quad.height)*0.42,bPad=Math.min(b.quad.width,b.quad.height)*0.42;
      const p1={x:a.quad.cx+dx/len*aPad,y:a.quad.cy+dy/len*aPad},p2={x:b.quad.cx-dx/len*bPad,y:b.quad.cy-dy/len*bPad};
      const grad=ctx.createLinearGradient(p1.x,p1.y,p2.x,p2.y);grad.addColorStop(0,hexToRgba(a.color,.52));grad.addColorStop(1,hexToRgba(b.color,.52));
      ctx.save();ctx.strokeStyle=grad;ctx.lineWidth=1.5;ctx.shadowColor=a.color;ctx.shadowBlur=glow?5:0;ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();ctx.restore();
    }
  }
}

function drawNote(ctx:CanvasRenderingContext2D,n:Placed,glow:boolean){
  const q=n.quad;
  if(n.tailQuad){const t=n.tailQuad;ctx.save();ctx.beginPath();ctx.moveTo(t.farLeft.x,t.farLeft.y);ctx.lineTo(t.farRight.x,t.farRight.y);ctx.lineTo(q.nearRight.x,q.nearRight.y);ctx.lineTo(q.nearLeft.x,q.nearLeft.y);ctx.closePath();ctx.fillStyle=hexToRgba(n.color,.2);ctx.fill();ctx.restore();}
  ctx.save();quadPath(ctx,q);
  const base=n.label?NOTE_ORANGE:n.color;
  const grad=ctx.createLinearGradient(0,q.farLeft.y,0,q.nearLeft.y);grad.addColorStop(0,hexToRgba(base,.98));grad.addColorStop(1,hexToRgba(base,.68));
  ctx.fillStyle=grad;ctx.shadowColor=base;ctx.shadowBlur=glow?8:0;ctx.fill();ctx.strokeStyle="rgba(255,234,178,.9)";ctx.lineWidth=1;ctx.stroke();ctx.restore();
  if(n.label&&q.height>5){
    const angle=Math.atan2(q.nearRight.y-q.nearLeft.y,q.nearRight.x-q.nearLeft.x);
    const fs=Math.max(7,Math.min(22,q.height*0.9));ctx.save();ctx.translate(q.cx,q.cy);ctx.rotate(angle);ctx.textAlign="center";ctx.textBaseline="middle";ctx.font=`700 ${fs}px system-ui, sans-serif`;
    const tw=ctx.measureText(n.label).width,max=q.width*.82;if(tw>max)ctx.scale(max/tw,1);
    ctx.strokeStyle="rgba(70,34,4,.78)";ctx.lineWidth=Math.max(1.5,fs*.15);ctx.strokeText(n.label,0,0);ctx.fillStyle="rgba(255,245,220,.98)";ctx.fillText(n.label,0,0);ctx.restore();
  }
}

export function renderColumns(ctx:CanvasRenderingContext2D,w:number,h:number,f:StageFrame){
  const glow=quality.params.glow,v=stageViewport(w,h);
  ctx.save();ctx.fillStyle=SKY;ctx.fillRect(0,0,w,h);ctx.translate(v.x,v.y);ctx.beginPath();ctx.rect(0,0,v.w,v.h);ctx.clip();
  const g=geomOf(v.w,v.h);drawScene(ctx,g,f.now,glow);drawTopRow(ctx,g,f,glow);drawBottomRow(ctx,g,f,glow);
  if(f.showNotes!==false){const placed=placeNotes(g,f);drawChordLinks(ctx,placed,glow);for(const n of placed)drawNote(ctx,n,glow);}
  ctx.restore();ctx.save();ctx.translate(v.x,v.y);drawHud(ctx,v.w,v.h,f);ctx.restore();
}
