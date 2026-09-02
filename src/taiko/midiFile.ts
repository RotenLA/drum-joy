/**
 * 标准 MIDI 文件（SMF 0/1）解析：只取谱面需要的信息。
 * - header: ppq（每四分音符 tick 数）
 * - tempo map（含变速）、time signature map
 * - 所有 note-on（velocity > 0）事件，带 tick / note / velocity / channel
 *
 * 纯 JS，无依赖；tick → ms 走 tempo map，变速曲同样精确。
 */

export interface MidiTempo {
  tick: number;
  /** 每四分音符微秒数 */
  usPerQuarter: number;
  /** 该 tempo 生效点的毫秒时间（解析后填充） */
  timeMs: number;
}

export interface MidiTimeSignature {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface MidiNoteEvent {
  tick: number;
  timeMs: number;
  note: number;
  velocity: number;
  channel: number;
}

export interface ParsedMidi {
  ppq: number;
  tempos: MidiTempo[];
  timeSignatures: MidiTimeSignature[];
  notes: MidiNoteEvent[];
  /** 最后一个事件的时间（毫秒） */
  durationMs: number;
  /** 曲首 BPM */
  bpm: number;
  timeSignature: [number, number];
}

class Reader {
  pos = 0;
  constructor(private view: DataView) {}
  get length(): number {
    return this.view.byteLength;
  }
  u8(): number {
    return this.view.getUint8(this.pos++);
  }
  u16(): number {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  str(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.view.getUint8(this.pos + i));
    this.pos += n;
    return s;
  }
  varint(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return v;
  }
  skip(n: number): void {
    this.pos += n;
  }
}

interface RawEvent {
  tick: number;
  kind: "note" | "tempo" | "timesig";
  note?: number;
  velocity?: number;
  channel?: number;
  usPerQuarter?: number;
  numerator?: number;
  denominator?: number;
}

/** 解析 SMF；失败抛错 */
export function parseMidi(buffer: ArrayBuffer): ParsedMidi {
  const r = new Reader(new DataView(buffer));
  if (r.str(4) !== "MThd") throw new Error("不是有效的 MIDI 文件");
  const headerLen = r.u32();
  r.u16(); // format
  const trackCount = r.u16();
  const division = r.u16();
  r.skip(headerLen - 6);
  if (division & 0x8000) throw new Error("暂不支持 SMPTE 时间码的 MIDI");
  const ppq = division || 480;

  const events: RawEvent[] = [];

  for (let t = 0; t < trackCount && r.pos < r.length; t++) {
    const id = r.str(4);
    const len = r.u32();
    const end = r.pos + len;
    if (id !== "MTrk") {
      r.pos = end;
      continue;
    }
    let tick = 0;
    let running = 0;
    while (r.pos < end) {
      tick += r.varint();
      let status = r.u8();
      if (status < 0x80) {
        r.pos--;
        status = running;
      } else if (status < 0xf0) {
        running = status;
      }
      const type = status & 0xf0;
      const channel = status & 0x0f;
      if (status === 0xff) {
        const meta = r.u8();
        const mlen = r.varint();
        const at = r.pos;
        if (meta === 0x51 && mlen === 3) {
          const usPerQuarter = (r.u8() << 16) | (r.u8() << 8) | r.u8();
          events.push({ tick, kind: "tempo", usPerQuarter });
        } else if (meta === 0x58 && mlen >= 2) {
          const numerator = r.u8();
          const denominator = 2 ** r.u8();
          events.push({ tick, kind: "timesig", numerator, denominator });
        }
        r.pos = at + mlen;
      } else if (status === 0xf0 || status === 0xf7) {
        const slen = r.varint();
        r.skip(slen);
      } else if (type === 0x90) {
        const note = r.u8();
        const velocity = r.u8();
        if (velocity > 0) events.push({ tick, kind: "note", note, velocity, channel });
      } else if (type === 0x80 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
        r.skip(2);
      } else if (type === 0xc0 || type === 0xd0) {
        r.skip(1);
      } else {
        // 未知状态：放弃该轨剩余内容
        break;
      }
    }
    r.pos = end;
  }

  events.sort((a, b) => a.tick - b.tick);

  // tempo map（先补一个默认 120 BPM 起点）
  const tempos: MidiTempo[] = [];
  const tempoEvents = events.filter((e) => e.kind === "tempo");
  if (tempoEvents.length === 0 || (tempoEvents[0]?.tick ?? 0) > 0) {
    tempos.push({ tick: 0, usPerQuarter: 500000, timeMs: 0 });
  }
  for (const e of tempoEvents) {
    const last = tempos[tempos.length - 1];
    const prevTick = last?.tick ?? 0;
    const prevMs = last?.timeMs ?? 0;
    const prevUs = last?.usPerQuarter ?? 500000;
    const timeMs = prevMs + ((e.tick - prevTick) * prevUs) / (ppq * 1000);
    if (last && e.tick === last.tick) {
      last.usPerQuarter = e.usPerQuarter!;
    } else {
      tempos.push({ tick: e.tick, usPerQuarter: e.usPerQuarter!, timeMs });
    }
  }

  const toMs = (tick: number): number => {
    let i = 0;
    while (i + 1 < tempos.length && tempos[i + 1]!.tick <= tick) i++;
    const seg = tempos[i]!;
    return seg.timeMs + ((tick - seg.tick) * seg.usPerQuarter) / (ppq * 1000);
  };

  const timeSignatures: MidiTimeSignature[] = events
    .filter((e) => e.kind === "timesig")
    .map((e) => ({ tick: e.tick, numerator: e.numerator!, denominator: e.denominator! }));
  if (timeSignatures.length === 0 || (timeSignatures[0]?.tick ?? 0) > 0) {
    timeSignatures.unshift({ tick: 0, numerator: 4, denominator: 4 });
  }

  const notes: MidiNoteEvent[] = events
    .filter((e) => e.kind === "note")
    .map((e) => ({
      tick: e.tick,
      timeMs: toMs(e.tick),
      note: e.note!,
      velocity: e.velocity!,
      channel: e.channel!,
    }));

  const lastTick = events.length > 0 ? events[events.length - 1]!.tick : 0;
  const first = tempos[0]!;
  const firstSig = timeSignatures[0]!;

  return {
    ppq,
    tempos,
    timeSignatures,
    notes,
    durationMs: toMs(lastTick),
    bpm: 60000000 / first.usPerQuarter,
    timeSignature: [firstSig.numerator, firstSig.denominator],
  };
}

/** tick → 毫秒（走 tempo map） */
export function tickToMs(midi: ParsedMidi, tick: number): number {
  const { tempos, ppq } = midi;
  let i = 0;
  while (i + 1 < tempos.length && tempos[i + 1]!.tick <= tick) i++;
  const seg = tempos[i]!;
  return seg.timeMs + ((tick - seg.tick) * seg.usPerQuarter) / (ppq * 1000);
}

/** 毫秒 → tick */
export function msToTick(midi: ParsedMidi, ms: number): number {
  const { tempos, ppq } = midi;
  let i = 0;
  while (i + 1 < tempos.length && tempos[i + 1]!.timeMs <= ms) i++;
  const seg = tempos[i]!;
  return seg.tick + ((ms - seg.timeMs) * ppq * 1000) / seg.usPerQuarter;
}
