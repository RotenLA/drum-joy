/**
 * Web MIDI 输入管理：枚举输入设备、选择设备、订阅 note-on。
 * Electron / Chromium 原生支持；不支持的环境 init() 返回 false。
 * 未选择设备时监听全部输入（方便映射屏验证接线）。
 */

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
    // note-on：0x90 且力度 > 0（力度 0 视为 note-off）
    if ((d[0]! & 0xf0) === 0x90 && d[2]! > 0) {
      for (const f of this.noteListeners) f(d[1]!, d[2]!);
    }
  }

  onNote(fn: NoteListener): () => void {
    this.noteListeners.add(fn);
    return () => {
      this.noteListeners.delete(fn);
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
