/** MIDI note-on 到达间隔诊断缓冲。 */

export type DebugKind = "midi" | "inject" | "stick" | "system";

export interface DebugEntry {
  id: number;
  /** Date.now() */
  t: number;
  note: number;
  velocity: number;
  /** 与上一条 note-on 的网页接收时刻之差；首条为 null */
  deltaMs: number | null;
}

/** 最多保留的条数 */
const MAX = 200;

class DebugLog {
  private items: DebugEntry[] = [];
  private seq = 0;
  private listeners = new Set<() => void>();
  private lastMidiAt: number | null = null;
  /** 面板关闭时完全不记录，避免白白消耗性能 */
  private enabled = false;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.items = [];
      this.lastMidiAt = null;
    }
  }

  get on(): boolean {
    return this.enabled;
  }

  /** 仅保留兼容入口；非 note-on 调试信息不再记录。 */
  push(_kind: DebugKind, _text: string): void {}

  recordMidiNote(note: number, velocity: number): void {
    if (!this.enabled) return;
    const receivedAt = performance.now();
    const deltaMs = this.lastMidiAt === null ? null : receivedAt - this.lastMidiAt;
    this.lastMidiAt = receivedAt;
    this.items.push({ id: ++this.seq, t: Date.now(), note, velocity, deltaMs });
    if (this.items.length > MAX) this.items.splice(0, this.items.length - MAX);
    for (const f of this.listeners) f();
  }

  list(): readonly DebugEntry[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
    this.lastMidiAt = null;
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
