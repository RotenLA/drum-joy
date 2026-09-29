import { tickToMs, type MidiTempo, type ParsedMidi } from "./midiFile";

export interface TempoSegment {
  timeMs: number;
  bpm: number;
  confidence: number;
}

export interface TempoAnalysis {
  bpm: number;
  confidence: number;
  status: "confident" | "review";
  segments: TempoSegment[];
  midi: ParsedMidi;
}

const ENVELOPE_HZ = 100;
const MIN_BPM = 80;
const MAX_BPM = 180;
const WINDOW_SECONDS = 24;
const WINDOW_HOP_SECONDS = 12;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] ?? 0 : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) * 0.5;
}

function normalizeBpm(value: number): number {
  let bpm = value;
  while (bpm < MIN_BPM) bpm *= 2;
  while (bpm > MAX_BPM) bpm *= 0.5;
  return Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
}

/** 将音频降采样为 100Hz 瞬态包络；只保留正向能量变化，降低持续人声的影响。 */
export function onsetEnvelope(buffer: AudioBuffer): Float32Array {
  const frame = Math.max(1, Math.round(buffer.sampleRate / ENVELOPE_HZ));
  const count = Math.max(1, Math.ceil(buffer.length / frame));
  const energy = new Float32Array(count);
  for (let n = 0; n < count; n++) {
    const from = n * frame;
    const to = Math.min(buffer.length, from + frame);
    let sum = 0;
    let samples = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = from; i < to; i += 4) {
        const value = data[i] ?? 0;
        sum += value * value;
        samples++;
      }
    }
    energy[n] = Math.sqrt(sum / Math.max(1, samples));
  }
  const onset = new Float32Array(count);
  for (let i = 1; i < count; i++) onset[i] = Math.max(0, (energy[i] ?? 0) - (energy[i - 1] ?? 0));
  const floor = median(Array.from(onset)) * 2.5;
  let peak = 0;
  for (let i = 0; i < onset.length; i++) {
    onset[i] = Math.max(0, (onset[i] ?? 0) - floor);
    peak = Math.max(peak, onset[i] ?? 0);
  }
  if (peak > 0) for (let i = 0; i < onset.length; i++) onset[i] = (onset[i] ?? 0) / peak;
  return onset;
}

function midiAccentAtBeat(midi: ParsedMidi, beat: number): number {
  const tick = beat * midi.ppq;
  const radius = midi.ppq / 10;
  let score = 0;
  for (const note of midi.notes) {
    if (Math.abs(note.tick - tick) > radius) continue;
    const strength = Math.max(0.2, note.velocity / 127);
    if (note.note === 35 || note.note === 36) score += 1.3 * strength;
    else if (note.note === 38 || note.note === 40) score += strength;
    else if (note.note === 49 || note.note === 57) score += 1.15 * strength;
    else score += 0.25 * strength;
  }
  return score;
}

function candidateScore(
  envelope: Float32Array,
  midi: ParsedMidi,
  bpm: number,
  from: number,
  to: number,
): number {
  const lag = (60 * ENVELOPE_HZ) / bpm;
  let correlation = 0;
  let weight = 0;
  for (let i = Math.max(from + Math.ceil(lag), 1); i < to; i++) {
    const a = envelope[i] ?? 0;
    const b = envelope[Math.round(i - lag)] ?? 0;
    correlation += a * b;
    weight += a * a;
  }
  const periodicity = correlation / Math.max(0.0001, weight);
  let grid = 0;
  let gridWeight = 0;
  let onsetTotal = 0;
  for (let i = from; i < to; i++) onsetTotal += envelope[i] ?? 0;
  const startBeat = Math.floor((from / ENVELOPE_HZ) * bpm / 60);
  const endBeat = Math.ceil((to / ENVELOPE_HZ) * bpm / 60);
  for (let beat = startBeat; beat <= endBeat; beat++) {
    const at = Math.round((beat * 60 * ENVELOPE_HZ) / bpm);
    if (at < from || at >= to) continue;
    const local = Math.max(envelope[at] ?? 0, envelope[at - 1] ?? 0, envelope[at + 1] ?? 0);
    const accent = 0.6 + Math.min(1.8, midiAccentAtBeat(midi, beat));
    grid += local * accent;
    gridWeight += accent;
  }
  const precision = grid / Math.max(1, gridWeight);
  const coverage = grid / Math.max(0.001, onsetTotal);
  const peakIntervals: number[] = [];
  let previousPeak = -1;
  for (let i = from + 1; i < to - 1; i++) {
    const value = envelope[i] ?? 0;
    if (value < 0.3 || value < (envelope[i - 1] ?? 0) || value < (envelope[i + 1] ?? 0)) continue;
    if (previousPeak >= 0 && i - previousPeak >= 8 && i - previousPeak <= 80) peakIntervals.push(i - previousPeak);
    previousPeak = i;
  }
  const pulseBpm = peakIntervals.length >= 4 ? normalizeBpm((60 * ENVELOPE_HZ) / median(peakIntervals)) : 0;
  const pulseFit = pulseBpm > 0 ? Math.max(0, 1 - Math.abs(bpm - pulseBpm) / 12) : 0;
  // precision 防止高 BPM 网格乱撞，coverage 则用于解开半速/双速歧义。
  return periodicity * 0.27 + precision * 0.18 + Math.min(1, coverage) * 0.35 + pulseFit * 0.2;
}

function bestTempo(envelope: Float32Array, midi: ParsedMidi, from: number, to: number) {
  let bestBpm = 120;
  let best = -Infinity;
  let second = -Infinity;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    const score = candidateScore(envelope, midi, bpm, from, to);
    if (score > best) {
      second = best;
      best = score;
      bestBpm = bpm;
    } else if (Math.abs(bpm - bestBpm) > 3) {
      second = Math.max(second, score);
    }
  }
  const confidence = Math.max(0, Math.min(1, (best - Math.max(0, second)) / Math.max(0.02, best) * 2.4));
  return { bpm: normalizeBpm(bestBpm), confidence, score: best };
}

function stableSegments(envelope: Float32Array, midi: ParsedMidi): TempoSegment[] {
  const windowSize = WINDOW_SECONDS * ENVELOPE_HZ;
  const hop = WINDOW_HOP_SECONDS * ENVELOPE_HZ;
  if (envelope.length <= windowSize) {
    const one = bestTempo(envelope, midi, 0, envelope.length);
    return [{ timeMs: 0, bpm: one.bpm, confidence: one.confidence }];
  }
  const windows: TempoSegment[] = [];
  for (let from = 0; from < envelope.length; from += hop) {
    const to = Math.min(envelope.length, from + windowSize);
    if (to - from < windowSize * 0.55) break;
    const found = bestTempo(envelope, midi, from, to);
    windows.push({ timeMs: (from / ENVELOPE_HZ) * 1000, bpm: found.bpm, confidence: found.confidence });
  }
  const out: TempoSegment[] = [];
  for (let i = 0; i < windows.length; i++) {
    const current = windows[i];
    if (!current) continue;
    const next = windows[i + 1];
    const previous = out[out.length - 1];
    const agrees = next && Math.abs(next.bpm - current.bpm) <= 3;
    if (!previous) {
      out.push({ ...current, timeMs: 0 });
    } else if (agrees && Math.abs(previous.bpm - current.bpm) > 5 && current.confidence >= 0.12) {
      out.push({ ...current, bpm: Math.round(((current.bpm + next.bpm) * 0.5) * 10) / 10 });
    }
  }
  return out;
}

function retimeMidi(source: ParsedMidi, segments: TempoSegment[]): ParsedMidi {
  const tempos: MidiTempo[] = [];
  let lastTimeMs = 0;
  let lastTick = 0;
  let lastBpm = segments[0]?.bpm ?? 120;
  tempos.push({ tick: 0, timeMs: 0, usPerQuarter: 60000000 / lastBpm });
  for (const segment of segments.slice(1)) {
    const elapsed = Math.max(0, segment.timeMs - lastTimeMs);
    const tick = Math.max(lastTick + 1, Math.round(lastTick + (elapsed * lastBpm * source.ppq) / 60000));
    tempos.push({ tick, timeMs: segment.timeMs, usPerQuarter: 60000000 / segment.bpm });
    lastTimeMs = segment.timeMs;
    lastTick = tick;
    lastBpm = segment.bpm;
  }
  const shell: ParsedMidi = { ...source, tempos, bpm: segments[0]?.bpm ?? source.bpm, notes: [], durationMs: 0 };
  const notes = source.notes.map((note) => ({ ...note, timeMs: tickToMs(shell, note.tick) }));
  const lastSourceTick = source.notes.reduce((max, note) => Math.max(max, note.tick), 0);
  return { ...shell, notes, durationMs: tickToMs(shell, lastSourceTick) };
}

export function analyzeAudioTempo(buffer: AudioBuffer, midi: ParsedMidi): TempoAnalysis {
  const envelope = onsetEnvelope(buffer);
  let segments = stableSegments(envelope, midi);
  if (!segments.length) segments = [{ timeMs: 0, bpm: 120, confidence: 0 }];
  const durationMs = Math.max(1, buffer.duration * 1000);
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;
    const end = segments[i + 1]?.timeMs ?? durationMs;
    const span = Math.max(0, end - segment.timeMs);
    weighted += segment.bpm * span;
    total += span;
  }
  const confidence = segments.reduce((sum, segment) => sum + segment.confidence, 0) / segments.length;
  const bpm = Math.round((weighted / Math.max(1, total)) * 10) / 10;
  return {
    bpm,
    confidence,
    status: confidence >= 0.12 ? "confident" : "review",
    segments,
    midi: retimeMidi(midi, segments),
  };
}

export async function decodeAndAnalyzeTempo(file: File, midi: ParsedMidi): Promise<TempoAnalysis> {
  const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) throw new Error("当前浏览器无法分析音频速度");
  const context = new AudioCtor();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    return analyzeAudioTempo(buffer, midi);
  } finally {
    void context.close();
  }
}

export function tempoFingerprint(midi: ParsedMidi): string {
  return midi.tempos.map((tempo) => `${tempo.tick}:${Math.round(tempo.usPerQuarter)}`).join("|");
}