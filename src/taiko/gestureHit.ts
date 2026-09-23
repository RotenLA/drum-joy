/**
 * 角度触发击打（实验版，仅测试模式使用）
 *
 * 思路：宿主的姿态流（window.__pd2uSticks）比蓝牙 MIDI 更快更均匀，
 * 所以手部七个鼓面的「敲到了」不再等 MIDI NoteOn，而是直接从俯仰角轨迹里
 * 识别「快速下探 → 触底反弹」的拐点，拐点出现的那一帧立刻判定为一次击打。
 *
 * 落点鼓面沿用开发标定的角度分区（stickMapping），力度由下探角速度映射。
 * 双脚踏板（kick / pedalHat）仍由 MIDI 负责，本模块不处理。
 */
import { PART_BY_ID, type PartId } from "./laneLayouts";
import { partOfPose } from "./stickMapping";
import { stickManager, type StickPose, type StickSide, type StickSnapshot } from "./stickInput";

/** 进入下探状态的角速度阈值（度/秒，负向为往下） */
const ARM_SPEED = 240;
/** 下探结束（触底 / 反弹）判定：角速度回升到这个值以上 */
const RELEASE_SPEED = 45;
/** 同一根棒两次击打的最短间隔（毫秒） */
const REFRACTORY_MS = 120;
/** 一次下探的最小幅度（度），避免轻微抖动误触 */
const MIN_TRAVEL_DEG = 10;
/**
 * 宿主姿态流只有 25~30Hz，一次挥击常被切成 2~3 帧，
 * 单帧瞬时速度到不了 ARM_SPEED。所以先把「持续往下」的帧串起来，
 * 在这个窗口（毫秒）内累计行程与峰值速度，再判断是否够一次击打。
 */
const DOWN_WINDOW_MS = 130;
/** 认定「还在往下挥」的最小角速度（度/秒）：低于此视为停住 */
const DOWN_MIN_SPEED = 60;


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
  /** 下探开始那一刻的姿态（落点鼓面按它判定） */
  downPose: StickPose | null;
  /** 本次下探的峰值角速度（度/秒，正值） */
  peak: number;
  /** 本次下探累计行程（度） */
  travel: number;
  lastHitAt: number;
}

const newSide = (): SideState => ({
  lastP: null,
  lastAt: 0,
  downStartAt: 0,
  downPose: null,
  peak: 0,
  travel: 0,
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

class GestureHitDetector {
  private sides: Record<StickSide, SideState> = { l: newSide(), r: newSide() };
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
    if (prevP === null || dt <= 0 || dt > 0.25) return;

    // 角速度：负值代表棒头正在往下挥
    const v = (pose.p - prevP) / dt;

    // 还在往下挥：把连续的下探帧串成一次挥击，行程与峰值速度跨帧累计
    if (v <= -RELEASE_SPEED) {
      if (!s.downStartAt) {
        // 起手要有明确的下挥意图，纯缓慢移位不开始计一次挥击
        if (v > -DOWN_MIN_SPEED) return;
        s.downStartAt = at;
        s.downPose = { p: prevP, y: pose.y };
        s.peak = -v;
        s.travel = Math.max(0, prevP - pose.p);
        return;
      }
      // 超过窗口还在往下 = 慢慢压下去，不是敲击，从当前帧重新起算
      if (at - s.downStartAt > DOWN_WINDOW_MS) {
        s.downStartAt = at;
        s.downPose = { p: prevP, y: pose.y };
        s.peak = -v;
        s.travel = Math.max(0, prevP - pose.p);
        return;
      }
      s.peak = Math.max(s.peak, -v);
      s.travel += Math.max(0, prevP - pose.p);
      return;
    }

    // 触底 / 反弹（速度回升）→ 结算这一下
    const downPose = s.downPose;
    const peak = s.peak;
    const travel = s.travel;
    s.downStartAt = 0;
    s.downPose = null;
    s.peak = 0;
    s.travel = 0;
    if (!downPose) return;
    // 力度够猛 + 幅度够大 + 不在防抖窗内，才算一次敲击
    if (peak < ARM_SPEED || travel < MIN_TRAVEL_DEG) return;
    if (at - s.lastHitAt < REFRACTORY_MS) return;
    s.lastHitAt = at;
    // 落点用「下探开始时」的姿态：那一刻棒还指在目标鼓面上
    const part = partOfPose(downPose);
    this.emit?.({ side, part, velocity: velocityOf(peak), atMs: at, speed: peak });

  }
}

export const gestureHitDetector = new GestureHitDetector();
