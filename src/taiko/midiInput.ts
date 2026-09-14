/**
 * Web MIDI 输入管理：枚举输入设备、选择设备、订阅 note-on。
 * Electron / Chromium 原生支持；不支持的环境 init() 返回 false。
 * 未选择设备时监听全部输入（方便映射屏验证接线）。
 */

import { debugLog } from "./debugLog";
import { PART_BY_ID, partOfNote } from "./laneLayouts";

/** 音符号 → 「(部件名)」，未映射时留空 */
function partTag(note: number): string {
  const id = partOfNote(note);
  return id ? ` (${PART_BY_ID[id].label})` : "";
}

export interface MidiInputInfo {
  id: string;
  name: string;
}

interface MidiMessageLike {
  data: Uint8Array | null;
}

interface MidiInputLike {
  id: string;
  name?: string | null;
  onmidimessage: ((e: MidiMessageLike) => void) | null;
}

interface MidiAccessLike {
  inputs: Map<string, MidiInputLike>;
  onstatechange: (() => void) | null;
}

type NoteListener = (note: number, velocity: number) => void;
type NoteOffListener = (note: number) => void;
type StateListener = () => void;

class MidiManager {
  private access: MidiAccessLike | null = null;
  private noteListeners = new Set<NoteListener>();
  private noteOffListeners = new Set<NoteOffListener>();
  private stateListeners = new Set<StateListener>();
  private selectedId: string | null = null;

  get supported(): boolean {
    return (
      typeof navigator !== "undefined" && "requestMIDIAccess" in navigator
    );
  }

  async init(): Promise<boolean> {
    if (this.access) return true;
    if (!this.supported) return false;
    try {
      const nav = navigator as unknown as {
        requestMIDIAccess: () => Promise<MidiAccessLike>;
      };
      this.access = await nav.requestMIDIAccess();
      this.access.onstatechange = () => {
        this.bind();
        debugLog.push("system", `MIDI 设备变化，当前 ${this.inputs().length} 个输入`);
        for (const f of this.stateListeners) f();
      };
      this.bind();
      return true;
    } catch {
      return false;
    }
  }

  inputs(): MidiInputInfo[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => ({
      id: i.id,
      name: i.name ?? i.id,
    }));
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.bind();
  }

  private bind(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage =
        !this.selectedId || input.id === this.selectedId
          ? (e) => this.handle(e)
          : null;
    }
  }

  private handle(e: MidiMessageLike): void {
    const d = e.data;
    if (!d || d.length < 3) return;
    const status = d[0]! & 0xf0;
    // note-on：0x90 且力度 > 0（力度 0 视为 note-off）
    if (status === 0x90 && d[2]! > 0) {
      debugLog.push("midi", `硬件 note-on  ${d[1]} vel ${d[2]}${partTag(d[1]!)}`);
      for (const f of this.noteListeners) f(d[1]!, d[2]!);
    } else if (status === 0x80 || (status === 0x90 && d[2]! === 0)) {
      debugLog.push("midi", `硬件 note-off ${d[1]}${partTag(d[1]!)}`);
      for (const f of this.noteOffListeners) f(d[1]!);
    }
  }

  /**
   * 宿主（Unity 等）注入 note-on：与硬件消息走同一套 listener，
   * 因此映射、判定、鼓盘闪光行为完全一致。
   */
  injectNoteOn(note: number, velocity: number): void {
    const n = Math.round(note);
    const v = Math.round(velocity);
    if (n < 0 || n > 127 || v < 1 || v > 127) return;
    debugLog.push("inject", `注入 note-on  ${n} vel ${v}${partTag(n)}`);
    for (const f of this.noteListeners) f(n, v);
  }

  /** 宿主注入 note-off（长音符判定用） */
  injectNoteOff(note: number): void {
    const n = Math.round(note);
    if (n < 0 || n > 127) return;
    debugLog.push("inject", `注入 note-off ${n}${partTag(n)}`);
    for (const f of this.noteOffListeners) f(n);
  }

  onNote(fn: NoteListener): () => void {
    this.noteListeners.add(fn);
    return () => {
      this.noteListeners.delete(fn);
    };
  }

  /** note-off（长音符「全程按住」判定用） */
  onNoteOff(fn: NoteOffListener): () => void {
    this.noteOffListeners.add(fn);
    return () => {
      this.noteOffListeners.delete(fn);
    };
  }

  onState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => {
      this.stateListeners.delete(fn);
    };
  }
}

export const midiManager = new MidiManager();

/**
 * 暴露给 Unity 等宿主的 JS 桥：
 *   __pd2uNoteOn(note, velocity)  敲击，note 0-127，velocity 1-127
 *   __pd2uNoteOff(note)           松开（长音符判定用）
 * 幂等，可重复调用。仅浏览器环境挂载。
 */
export function installExternalBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (w["__pd2uBridgeInstalled"]) return;
  w["__pd2uBridgeInstalled"] = true;
  w["__pd2uNoteOn"] = (note: number, velocity: number) =>
    midiManager.injectNoteOn(note, velocity);
  w["__pd2uNoteOff"] = (note: number) => midiManager.injectNoteOff(note);
  debugLog.push("system", "已挂载 window.__pd2uNoteOn / __pd2uNoteOff");
}
