/**
 * 鼓棒姿态输入：宿主（Unity）每帧调用 window.__pd2uSticks(snapshot) 注入
 * 左右鼓棒的俯仰/偏航角，网页据此实时绘制两根鼓棒。
 *
 *   window.__pd2uSticks({ v: 1, l: { p: 12.3, y: -45.6 }, r: { p: -8.1, y: 30 } })
 *
 * 超过 STICK_STALE_MS 没有新快照即视为无数据，画面不绘制鼓棒。
 */
import { debugLog } from "./debugLog";
import { PAD_ANCHORS, type PartId } from "./laneLayouts";
import { stickPoint, type StickLayer } from "./stickMapping";

export type StickSide = "l" | "r";

export interface StickLayerTransition {
  from: StickLayer;
  to: StickLayer;
  at: number;
}

export interface StickPose {
  /** pitch 俯仰角（度） */
  p: number;
  /** yaw 偏航角（度） */
  y: number;
}

export interface StickSnapshot {
  v: number;
  l: StickPose | null;
  r: StickPose | null;
  /** 接收时刻（performance.now()） */
  at: number;
  layers: Record<StickSide, StickLayer>;
  transitions: Record<StickSide, StickLayerTransition | null>;
}

/**
 * 快照过期时间（毫秒）：宿主停止推送即视为停流，鼓棒消失。
 * 源数据约 25Hz，接口约定「>1s 无调用 = 停流」，故取 1000。
 */
export const STICK_STALE_MS = 1000;

const clampAngle = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(-180, Math.min(180, n));
};

const parsePose = (raw: unknown): StickPose | null => {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const p = clampAngle(o["p"]);
  const y = clampAngle(o["y"]);
  if (p === null || y === null) return null;
  return { p, y };
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

class StickManager {
  private snap: StickSnapshot | null = null;
  private lastLog = 0;
  private layers: Record<StickSide, StickLayer> = { l: "lower", r: "lower" };
  private transitions: Record<StickSide, StickLayerTransition | null> = { l: null, r: null };

  /** 最新快照；过期或从未收到返回 null */
  latest(): StickSnapshot | null {
    if (!this.snap) return null;
    if (now() - this.snap.at > STICK_STALE_MS) return null;
    return this.snap;
  }

  push(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const o = raw as Record<string, unknown>;
    const v = typeof o["v"] === "number" ? (o["v"] as number) : 1;
    const l = parsePose(o["l"]);
    const r = parsePose(o["r"]);
    const at = now();
    this.snap = { v, l, r, at, layers: { ...this.layers }, transitions: { ...this.transitions } };
    // 每帧都来，按 100ms 节流打印，避免刷屏
    if (at - this.lastLog >= 100) {
      this.lastLog = at;
      const f = (s: StickPose | null) => (s ? `p${s.p.toFixed(1)}/y${s.y.toFixed(1)}` : "—");
      debugLog.push("stick", `L ${f(l)}  R ${f(r)}`);
    }
  }

  resetLayers(): void {
    this.layers = { l: "lower", r: "lower" };
    this.transitions = { l: null, r: null };
    if (this.snap) this.snap = { ...this.snap, layers: { ...this.layers }, transitions: { ...this.transitions } };
  }

  /** 只有当前画面可见的手击鼓面才可触发上下层切换；踏板不参与。 */
  switchLayerForHit(part: PartId, visibleParts: readonly PartId[], preferredSide?: StickSide): void {
    if (!visibleParts.includes(part)) return;
    const layer: StickLayer | null =
      part === "crash" || part === "highTom" || part === "midTom" || part === "ride"
        ? "upper"
        : part === "hihat" || part === "snare" || part === "floorTom"
          ? "lower"
          : null;
    if (!layer) return;

    const side = preferredSide ?? this.closestSide(part);
    const previous = this.layers[side];
    if (previous === layer) return;
    const at = now();
    this.layers = { ...this.layers, [side]: layer };
    this.transitions = { ...this.transitions, [side]: { from: previous, to: layer, at } };
    if (this.snap) this.snap = { ...this.snap, layers: { ...this.layers }, transitions: { ...this.transitions } };
    debugLog.push("stick", `${side.toUpperCase()} ${previous} → ${layer} (${part})`);
  }

  private closestSide(part: PartId): StickSide {
    const targetX = PAD_ANCHORS[part].cx;
    const poseL = this.snap?.l;
    const poseR = this.snap?.r;
    if (!poseL && !poseR) return targetX < 0.5 ? "l" : "r";
    if (!poseL) return "r";
    if (!poseR) return "l";
    const lx = stickPoint(poseL, this.layers.l).x;
    const rx = stickPoint(poseR, this.layers.r).x;
    return Math.abs(lx - targetX) <= Math.abs(rx - targetX) ? "l" : "r";
  }
}

export const stickManager = new StickManager();

/** 幂等挂载 window.__pd2uSticks */
export function installStickBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (w["__pd2uSticksInstalled"]) return;
  w["__pd2uSticksInstalled"] = true;
  w["__pd2uSticks"] = (snapshot: unknown) => stickManager.push(snapshot);
  debugLog.push("system", "已挂载 window.__pd2uSticks（鼓棒姿态接口）");
}
