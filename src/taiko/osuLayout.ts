/**
 * osu! 模式落点布局：把谱面音符预计算成舞台平面上的随机鼓盘落点。
 *
 * 纯函数 + 确定性伪随机（种子只取音符序号），同一份谱面每次进入结果一致，
 * 便于反复练习。相邻很近的音符归为一「连打串」，落点沿一个方向小步移动，
 * 渲染层据此画顺序连线。
 */
import type { TaikoChart } from "@/shared/taikoChart";
import { partOfNote, type PartId } from "./laneLayouts";

/** 可用落点区域（归一化，避开 HUD 与底部 vignette） */
export const OSU_AREA = { x0: 0.14, x1: 0.86, y0: 0.26, y1: 0.86 } as const;
/** 鼓盘基准横向半径（相对画布宽） */
export const OSU_PAD_R = 0.062;

export interface OsuPlacement {
  /** 对应 chart.notes 的下标（判定状态按此索引） */
  noteIndex: number;
  part: PartId;
  timeMs: number;
  big: boolean;
  /** 归一化中心 */
  cx: number;
  cy: number;
  /** 远小近大的尺寸系数 */
  scale: number;
  /** 连打串 id 与串内序号（1 起） */
  chainId: number;
  chainOrder: number;
  /** 串内上一颗的下标（用于画连线），无则 null */
  chainPrev: number | null;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scaleAt(cy: number): number {
  const k = (cy - OSU_AREA.y0) / (OSU_AREA.y1 - OSU_AREA.y0);
  return 0.85 + 0.4 * k;
}

/**
 * 预计算落点。
 * @param approachMs 圆圈提前出现的时长（毫秒，已含速度档换算）；用于避让同屏落点
 */
export function buildOsuLayout(
  chart: TaikoChart,
  parts: readonly PartId[],
  approachMs: number,
): OsuPlacement[] {
  const beatMs = 60000 / Math.max(1, chart.bpm);
  const chainGap = beatMs * 0.6;
  const out: OsuPlacement[] = [];
  let chainId = 0;
  let chainOrder = 0;
  let chainAngle = 0;
  let prevTime = -Infinity;
  let prevIdx: number | null = null;

  for (let i = 0; i < chart.notes.length; i++) {
    const n = chart.notes[i]!;
    if (n.note === undefined) continue;
    const part = partOfNote(n.note);
    if (!part || !parts.includes(part)) continue;
    const rnd = mulberry32(i * 2654435761 + 12345);

    const inChain = n.timeMs - prevTime <= chainGap && out.length > 0;
    let cx: number;
    let cy: number;

    if (inChain) {
      const last = out[out.length - 1]!;
      chainOrder++;
      const step = OSU_PAD_R * (2.2 + rnd() * 0.6);
      chainAngle += (rnd() - 0.5) * 0.9;
      cx = last.cx + Math.cos(chainAngle) * step;
      cy = last.cy + Math.sin(chainAngle) * step * 0.62;
      // 出界则折返方向
      if (cx < OSU_AREA.x0 || cx > OSU_AREA.x1) {
        chainAngle = Math.PI - chainAngle;
        cx = last.cx + Math.cos(chainAngle) * step;
      }
      if (cy < OSU_AREA.y0 || cy > OSU_AREA.y1) {
        chainAngle = -chainAngle;
        cy = last.cy + Math.sin(chainAngle) * step * 0.62;
      }
      cx = Math.min(OSU_AREA.x1, Math.max(OSU_AREA.x0, cx));
      cy = Math.min(OSU_AREA.y1, Math.max(OSU_AREA.y0, cy));
    } else {
      chainId++;
      chainOrder = 1;
      chainAngle = rnd() * Math.PI * 2;
      // 与同屏仍存活的落点保持距离：多点候选取最优
      const alive = out.filter((p) => p.timeMs > n.timeMs - approachMs);
      let best = { cx: 0.5, cy: 0.5, d: -1 };
      for (let k = 0; k < 20; k++) {
        const tx = OSU_AREA.x0 + rnd() * (OSU_AREA.x1 - OSU_AREA.x0);
        const ty = OSU_AREA.y0 + rnd() * (OSU_AREA.y1 - OSU_AREA.y0);
        let d = Infinity;
        for (const p of alive) {
          const dx = p.cx - tx;
          const dy = (p.cy - ty) * 1.4;
          d = Math.min(d, Math.hypot(dx, dy));
        }
        if (d > best.d) best = { cx: tx, cy: ty, d };
        if (d > OSU_PAD_R * 3.4) break;
      }
      cx = best.cx;
      cy = best.cy;
    }

    out.push({
      noteIndex: i,
      part,
      timeMs: n.timeMs,
      big: !!n.big,
      cx,
      cy,
      scale: scaleAt(cy),
      chainId,
      chainOrder,
      chainPrev: inChain ? prevIdx : null,
    });
    prevTime = n.timeMs;
    prevIdx = i;
  }

  return out;
}
