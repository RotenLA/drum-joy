/**
 * 调试日志环形缓冲：MIDI 敲击/松开、宿主注入、鼓棒快照、系统事件。
 * 与 React 解耦，任何模块都可 push；面板订阅刷新。
 */

export type DebugKind = "midi" | "inject" | "stick" | "system";

export interface DebugEntry {
  id: number;
  /** Date.now() */
  t: number;
  kind: DebugKind;
  text: string;
}

/** 最多保留的条数 */
const MAX = 200;

class DebugLog {
  private items: DebugEntry[] = [];
  private seq = 0;
  private listeners = new Set<() => void>();

  push(kind: DebugKind, text: string): void {
    this.items.push({ id: ++this.seq, t: Date.now(), kind, text });
    if (this.items.length > MAX) this.items.splice(0, this.items.length - MAX);
    for (const f of this.listeners) f();
  }

  list(): readonly DebugEntry[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
    for (const f of this.listeners) f();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const debugLog = new DebugLog();

/** 时间戳格式：HH:MM:SS.mmm */
export function formatTime(t: number): string {
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(
    d.getMilliseconds(),
    3,
  )}`;
}
