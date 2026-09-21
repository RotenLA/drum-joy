/**
 * 设备连接状态：宿主（Unity）推全量快照与单条事件，页面据此显示状态与提示条。
 *
 *   window.__pd2uDeviceState(s)     宿主 → 页面推快照（状态 UI 的唯一数据源）
 *   window.__pd2uGetDeviceState()   页面 → 宿主同步查询（mount 后必查一次）
 *   window.__pd2uDeviceEvent(e)     宿主 → 页面播单条连接/断开事件（收到即提示，零去重）
 *
 * 快照 { v:1, m:适配器, l:左棒, r:右棒, f:踏板 }（bool）
 * 事件 { v:1, d:"m"|"l"|"r"|"f", c:true 连接 / false 断开 }
 */
import { debugLog } from "./debugLog";

export type DeviceKey = "m" | "l" | "r" | "f";

export interface DeviceSnapshot {
  v: number;
  /** 适配器 */
  m: boolean;
  /** 左鼓棒 */
  l: boolean;
  /** 右鼓棒 */
  r: boolean;
  /** 踏板 */
  f: boolean;
}

export interface DeviceEvent {
  d: DeviceKey;
  /** true = 已连接 */
  c: boolean;
  /** 收到时刻（用于提示条 key） */
  at: number;
}

const KEYS: DeviceKey[] = ["m", "l", "r", "f"];
const EMPTY: DeviceSnapshot = { v: 1, m: false, l: false, r: false, f: false };

const asBool = (v: unknown): boolean => v === true || v === 1 || v === "true";

function parseSnapshot(raw: unknown): DeviceSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    v: typeof o["v"] === "number" ? (o["v"] as number) : 1,
    m: asBool(o["m"]),
    l: asBool(o["l"]),
    r: asBool(o["r"]),
    f: asBool(o["f"]),
  };
}

class DeviceStateManager {
  private snap: DeviceSnapshot = EMPTY;
  private snapListeners = new Set<(s: DeviceSnapshot) => void>();
  private eventListeners = new Set<(e: DeviceEvent) => void>();
  private seq = 0;

  get state(): DeviceSnapshot {
    return this.snap;
  }

  /** 宿主有没有提供设备状态接口（没有时界面不显示状态区） */
  get available(): boolean {
    if (typeof window === "undefined") return false;
    const w = window as unknown as Record<string, unknown>;
    return typeof w["__pd2uGetDeviceState"] === "function" || this.received;
  }

  private received = false;

  pushSnapshot(raw: unknown): void {
    const next = parseSnapshot(raw);
    if (!next) return;
    this.received = true;
    this.snap = next;
    debugLog.push(
      "system",
      `设备快照 适配器${next.m ? "√" : "×"} L${next.l ? "√" : "×"} R${next.r ? "√" : "×"} 踏板${next.f ? "√" : "×"}`,
    );
    for (const f of this.snapListeners) f(next);
  }

  pushEvent(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const o = raw as Record<string, unknown>;
    const d = o["d"];
    if (typeof d !== "string" || !KEYS.includes(d as DeviceKey)) return;
    const c = asBool(o["c"]);
    const key = d as DeviceKey;
    // 事件同时更新快照，避免状态与提示不一致
    this.received = true;
    this.snap = { ...this.snap, [key]: c };
    debugLog.push("system", `设备事件 ${key} ${c ? "连接" : "断开"}`);
    const evt: DeviceEvent = { d: key, c, at: ++this.seq };
    for (const f of this.snapListeners) f(this.snap);
    for (const f of this.eventListeners) f(evt);
  }

  /** 页面主动同步查询宿主（mount 后必查一次） */
  query(): void {
    if (typeof window === "undefined") return;
    const w = window as unknown as Record<string, unknown>;
    const fn = w["__pd2uGetDeviceState"];
    if (typeof fn !== "function") return;
    try {
      const raw = (fn as () => unknown)();
      const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
      this.pushSnapshot(parsed);
    } catch {
      // 宿主未就绪，等它推快照
    }
  }

  subscribe(fn: (s: DeviceSnapshot) => void): () => void {
    this.snapListeners.add(fn);
    return () => {
      this.snapListeners.delete(fn);
    };
  }

  onEvent(fn: (e: DeviceEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => {
      this.eventListeners.delete(fn);
    };
  }
}

export const deviceState = new DeviceStateManager();

/** 幂等挂载 window.__pd2uDeviceState / __pd2uDeviceEvent */
export function installDeviceBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (w["__pd2uDeviceBridgeInstalled"]) return;
  w["__pd2uDeviceBridgeInstalled"] = true;
  w["__pd2uDeviceState"] = (s: unknown) =>
    deviceState.pushSnapshot(typeof s === "string" ? (JSON.parse(s) as unknown) : s);
  w["__pd2uDeviceEvent"] = (e: unknown) =>
    deviceState.pushEvent(typeof e === "string" ? (JSON.parse(e) as unknown) : e);
  debugLog.push("system", "已挂载 window.__pd2uDeviceState / __pd2uDeviceEvent");
  deviceState.query();
}
