/**
 * 角度触发击打（实验版，仅测试模式使用）
 *
 * 思路：宿主的姿态流（window.__pd2uSticks）比蓝牙 MIDI 更快更均匀，
 * 所以手部七个鼓面的「敲到了」不再等 MIDI NoteOn，而是直接从俯仰角轨迹里
 * 识别「快速下探 → 触底/停住」的拐点，拐点出现的那一帧立刻判定为一次击打。
 *
 * 落点判定：挥棒最终「停在哪就响哪」。整段下探经过的分区一律忽略，
 * 只取触底/停住那一刻的俯仰+偏航角送入开发标定的角度分区（stickMapping），
 * 落在哪个区就触发哪个鼓面；上下层带俯仰滞回，停在分界附近不串层。
 * 力度由下探峰值角速度映射。双脚踏板（kick / pedalHat）仍由 MIDI 负责。
 */
import { PART_BY_ID, type PartId } from "./laneLayouts";
import { layerOfPitch, partOfPose } from "./stickMapping";
import { stickManager, type StickPose, type StickSide, type StickSnapshot } from "./stickInput";

/** 起手门槛：一次挥击期间的峰值下探角速度（度/秒）需达到此值 */
const ARM_SPEED = 200;
/** 认定「开始往下挥」的角速度（度/秒） */
const DOWN_MIN_SPEED = 55;
/** 同一根棒两次击打的最短间隔（毫秒）：只滤传感器自身回弹震荡 */
const REFRACTORY_MS = 65;
/** 一次下探的最小累计幅度（度），避免轻微抖动误触 */
const MIN_TRAVEL_DEG = 6;
/**
 * 停住判定：正在下挥时若这段时间内俯仰角没有继续变低，
 * 视为已经触底（没有明显回弹的「按住不动」也能结算）。
 */
const STALL_MS = 55;



export interface GestureHit {
  side: StickSide;
  part: PartId;
  /** MIDI 力度 1-127（由下探速度映射） */
  velocity: number;
  /** 击打时刻（performance.now() 基准） */
  atMs: number;
  /** 峰值下探角速度（度/秒，调试用） */
  speed: number;
}

interface SideState {
  lastP: number | null;
  lastAt: number;
  /** 本次连续下探开始时刻；0 = 当前没有进行中的下探 */
  downStartAt: number;
  /** 本次下探的峰值角速度（度/秒，正值） */
  peak: number;
  /** 本次下探累计行程（度） */
  travel: number;
  /** 最近一帧完整姿态（触底结算时作为落点） */
  lastPose: StickPose | null;
  lastHitAt: number;
}

const newSide = (): SideState => ({
  lastP: null,
  lastAt: 0,
  downStartAt: 0,
  peak: 0,
  travel: 0,
  lastPose: null,
  lastHitAt: 0,
});


/** 峰值角速度 → MIDI 力度 */
function velocityOf(speed: number): number {
  const t = Math.max(0, Math.min(1, (speed - ARM_SPEED) / 700));
  return Math.round(52 + t * 75);
}

export function noteOfPart(part: PartId): number | undefined {
  return PART_BY_ID[part]?.notes[0];
}

/** 与 FallScreen 的 debugVisible 同规则：?debug=1 或 window.__pd2uDebug */
function gestureDebugOn(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  if (w["__pd2uDebug"]) return true;
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}

const glog = (text: string) => {
  if (gestureDebugOn()) console.log(`[gesture] ${text}`);
};

class GestureHitDetector {
  private sides: Record<StickSide, SideState> = { l: newSide(), r: newSide() };
  /** 每根棒当前所在层（用于落点的俯仰滞回） */
  private layers: Record<StickSide, "upper" | "lower"> = { l: "lower", r: "lower" };
  private off: (() => void) | null = null;
  private emit: ((hit: GestureHit) => void) | null = null;

  /** 开始监听姿态流并派发击打；返回停止函数 */
  start(onHit: (hit: GestureHit) => void): () => void {
    this.stop();
    this.emit = onHit;
    this.off = stickManager.onFrame((snap) => this.feed(snap));
    return () => this.stop();
  }

  stop(): void {
    this.off?.();
    this.off = null;
    this.emit = null;
    this.sides = { l: newSide(), r: newSide() };
  }

  private feed(snap: StickSnapshot): void {
    this.feedSide("l", snap.l, snap.at);
    this.feedSide("r", snap.r, snap.at);
  }

  private feedSide(side: StickSide, pose: StickPose | null, at: number): void {
    const s = this.sides[side];
    if (!pose) {
      this.sides[side] = newSide();
      return;
    }
    const prevP = s.lastP;
    const dt = (at - s.lastAt) / 1000;
    s.lastP = pose.p;
    s.lastAt = at;
    s.lastPose = pose;
    // 层资格逐帧跟随：抬棒进上层后就留在上层（滞回），落点只看停住时在哪个分区
    this.layers[side] = layerOfPitch(pose.p, this.layers[side]);
    if (prevP === null || dt <= 0 || dt > 0.25) return;

    // 角速度：负值代表棒头正在往下挥
    const v = (pose.p - prevP) / dt;

    // 还在往下挥：把连续的下探帧串成一次挥击，行程与峰值速度跨帧累计
    if (v <= -RELEASE_SPEED) {
      if (!s.downStartAt) {
        // 起手要有明确的下挥意图，纯缓慢移位不开始计一次挥击
        if (v > -DOWN_MIN_SPEED) return;
        s.downStartAt = at;
        s.peak = -v;
        s.travel = Math.max(0, prevP - pose.p);
        return;
      }
      // 超过窗口还在往下 = 慢慢压下去，不是敲击，从当前帧重新起算
      if (at - s.downStartAt > DOWN_WINDOW_MS) {
        s.downStartAt = at;
        s.peak = -v;
        s.travel = Math.max(0, prevP - pose.p);
        return;
      }
      s.peak = Math.max(s.peak, -v);
      s.travel += Math.max(0, prevP - pose.p);
      return;
    }

    // 触底 / 停住（速度回升）→ 结算这一下
    const peak = s.peak;
    const travel = s.travel;
    const wasDown = s.downStartAt !== 0;
    s.downStartAt = 0;
    s.peak = 0;
    s.travel = 0;
    if (!wasDown) return;
    // 力度够猛 + 幅度够大 + 不在防抖窗内，才算一次敲击
    // （留 0.5°/s 浮点余量：帧间隔换算出的速度常在阈值边上有微小误差）
    if (peak < ARM_SPEED - 0.5 || travel < MIN_TRAVEL_DEG) {
      glog(`${side} 触底但未达标 peak=${Math.round(peak)} travel=${travel.toFixed(1)}`);
      return;
    }
    if (at - s.lastHitAt < REFRACTORY_MS) return;
    s.lastHitAt = at;
    // 落点 = 停住那一刻的姿态：挥棒最终停在哪个区就触发哪个鼓面，
    // 途中经过的分区一律不算；上下层用滞回判定，防止分界附近串层。
    const landing = s.lastPose ?? pose;
    const part = partOfPose(landing, this.layers[side]);
    glog(`${side} 命中 ${part} p=${landing.p.toFixed(1)} y=${landing.y.toFixed(1)} peak=${Math.round(peak)}`);
    this.emit?.({ side, part, velocity: velocityOf(peak), atMs: at, speed: peak });

  }
}

export const gestureHitDetector = new GestureHitDetector();
