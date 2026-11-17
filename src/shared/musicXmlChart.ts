/**
 * MusicXML（Guitar Pro 导出的鼓谱）→ AeroGame A 档谱面，严格 1:1 不降密。
 * 纯字符串解析，不依赖 DOMParser，浏览器 / Electron / 测试环境通用。
 */
import { CHART_DATA_FORMAT, CHART_EXPORT_SCHEMA_VERSION, SONG_INFO_FORMAT, chartFileName } from "./chartExport";
import type { SplitExportFile } from "./chartExport";

export interface MusicXmlNote { timeMs: number; midiNote: number }
export interface MusicXmlChart {
  title: string;
  artist: string | null;
  bpm: number;
  timeSignature: [number, number];
  durationMs: number;
  beatMap: { beats: number[]; beatsPerBar: number; barPhase: number };
  notes: MusicXmlNote[];
  measureCount: number;
}

const tag = (s: string, name: string) => s.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim();
const has = (s: string, name: string) => new RegExp(`<${name}\\b[^>]*/?>`).test(s);
const all = (s: string, name: string) => [...s.matchAll(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, "g"))];
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** 乐器名 → GM 鼓号（无 fret 且无 midi-unpitched 时兜底） */
const NAME_FALLBACK: [RegExp, number][] = [
  [/pedal hi-?hat/i, 44], [/hi-?hat.*open/i, 46], [/hi-?hat/i, 42],
  [/side stick/i, 37], [/snare/i, 38], [/kick|bass drum/i, 36],
  [/ride.*bell/i, 53], [/ride/i, 51], [/china/i, 52], [/splash/i, 55], [/crash/i, 49],
  [/very low tom|low floor/i, 41], [/high floor/i, 43], [/low tom/i, 45], [/mid tom/i, 47], [/high tom/i, 50],
];

export function parseMusicXmlDrums(xml: string, fallbackTitle = "song"): MusicXmlChart {
  const instNote = new Map<string, number>();
  for (const [, attrs, body] of all(xml, "score-instrument")) {
    const id = attrs.match(/id="([^"]+)"/)?.[1];
    const name = tag(body, "instrument-name") ?? "";
    const hit = NAME_FALLBACK.find(([re]) => re.test(name));
    if (id && hit) instNote.set(id, hit[1]);
  }
  for (const [, attrs, body] of all(xml, "midi-instrument")) {
    const id = attrs.match(/id="([^"]+)"/)?.[1];
    const u = Number(tag(body, "midi-unpitched"));
    if (id && Number.isFinite(u) && u > 0) instNote.set(id, u - 1); // MusicXML 为 1 起计
  }

  const part = all(xml, "part")[0]?.[2];
  if (!part) throw new Error("XML 中没有找到谱表 <part>");
  const measures = all(part, "measure").map((m) => m[2] ?? "");
  if (!measures.length) throw new Error("XML 中没有小节");

  // 反复记号展开（forward/backward repeat + 1/2 房子）
  const order: { idx: number; pass: number }[] = [];
  {
    let start = 0;
    const done = new Set<number>();
    let pass = 1;
    for (let i = 0; i < measures.length; i++) {
      const m = measures[i]!;
      if (/<repeat[^>]*direction="forward"/.test(m) && pass === 1) start = i;
      const ending = m.match(/<ending[^>]*number="([^"]+)"[^>]*type="start"/)?.[1];
      if (ending && !ending.split(/[,\s]+/).map(Number).includes(pass)) continue;
      order.push({ idx: i, pass });
      const back = m.match(/<repeat[^>]*direction="backward"([^>]*)/);
      if (back && !done.has(i)) {
        const times = Number(back[0].match(/times="(\d+)"/)?.[1] ?? 2);
        if (pass < times) { pass++; i = start - 1; continue; }
        done.add(i); pass = 1;
      }
    }
  }

  let divisions = 1, bpm = 0, firstBpm = 0;
  let ts: [number, number] = [4, 4];
  let firstTs: [number, number] | null = null;
  let t = 0;
  const notes: MusicXmlNote[] = [];
  const beats: number[] = [];

  for (const { idx } of order) {
    const m = measures[idx]!;
    const d = Number(tag(m, "divisions")); if (d > 0) divisions = d;
    const tm = tag(m, "time");
    if (tm) { const b = Number(tag(tm, "beats")), bt = Number(tag(tm, "beat-type")); if (b > 0 && bt > 0) ts = [b, bt]; }
    firstTs ??= ts;
    // 按出现顺序处理元素（tempo 可在小节中途变化）
    const events = [...m.matchAll(/<(note|backup|forward|sound)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g)];
    let cursor = 0, maxCursor = 0, lastStart = 0;
    // 分段速度：记录 (div 位置, bpm)
    const tempoAt: { pos: number; bpm: number }[] = [];
    const msAt = (pos: number) => {
      let ms = 0, p = 0, cur = tempoAt[0]?.bpm ?? bpm;
      for (const seg of tempoAt) { if (seg.pos > pos) break; ms += ((seg.pos - p) / divisions) * 60000 / cur; p = seg.pos; cur = seg.bpm; }
      return ms + ((pos - p) / divisions) * 60000 / cur;
    };
    tempoAt.push({ pos: 0, bpm: bpm || 120 });
    for (const [, kind, attrs = "", , body = ""] of events) {
      if (kind === "sound") {
        const v = Number(attrs.match(/tempo="([\d.]+)"/)?.[1]);
        if (v > 0) { bpm = v; if (!firstBpm) firstBpm = v; if (cursor === 0) tempoAt[0] = { pos: 0, bpm: v }; else tempoAt.push({ pos: cursor, bpm: v }); }
        continue;
      }
      const dur = Number(tag(body, "duration") ?? 0);
      if (kind === "backup") { cursor -= dur; continue; }
      if (kind === "forward") { cursor += dur; maxCursor = Math.max(maxCursor, cursor); continue; }
      if (has(body, "grace")) continue;
      const chord = has(body, "chord");
      const start = chord ? lastStart : cursor;
      if (!has(body, "rest") && !/<tie[^>]*type="stop"/.test(body)) {
        const fret = Number(unesc(body).match(/<fret>(\d+)<\/fret>/)?.[1]);
        const inst = body.match(/<instrument[^>]*id="([^"]+)"/)?.[1];
        const midi = Number.isFinite(fret) && fret > 0 ? fret : inst != null ? instNote.get(inst) : undefined;
        if (midi != null) notes.push({ timeMs: t + msAt(start), midiNote: midi });
      }
      if (!chord) { lastStart = cursor; cursor += dur; maxCursor = Math.max(maxCursor, cursor); }
    }
    const nominal = ts[0] * divisions * (4 / ts[1]);
    const len = Math.max(nominal, maxCursor);
    const beatDiv = divisions * (4 / ts[1]);
    for (let b = 0; b * beatDiv < len - 1e-9; b++) beats.push(Math.round(t + msAt(b * beatDiv)));
    t += msAt(len);
  }

  if (!firstBpm) firstBpm = 120;
  const rawTitle = tag(xml, "work-title") ?? tag(xml, "movement-title");
  const artist = all(xml, "creator").find(([, a = ""]) => /composer|artist/i.test(a))?.[2]?.trim() || null;
  return {
    title: rawTitle ? unesc(rawTitle) : fallbackTitle,
    artist: artist ? unesc(artist) : null,
    bpm: firstBpm,
    timeSignature: firstTs ?? ts,
    durationMs: Math.round(t),
    beatMap: { beats, beatsPerBar: (firstTs ?? ts)[0], barPhase: 0 },
    notes: notes.map((n) => ({ timeMs: Math.round(n.timeMs), midiNote: n.midiNote }))
      .sort((a, b) => a.timeMs - b.timeMs || a.midiNote - b.midiNote),
    measureCount: order.length,
  };
}

/** 生成 `歌名.info.json` + `歌名 - A - game.json` */
export function buildMusicXmlExport(chart: MusicXmlChart, stem: string, audioDurationMs?: number): SplitExportFile[] {
  const durationMs = Math.round(audioDurationMs && audioDurationMs > 0 ? audioDurationMs : chart.durationMs);
  const id = `xml-${stem}`;
  const a = {
    format: CHART_DATA_FORMAT, schemaVersion: CHART_EXPORT_SCHEMA_VERSION, songId: id,
    difficulty: "A", difficultyLabel: "beginner", timeUnit: "milliseconds", coordinateSystem: "song-start",
    durationMs, beatMap: chart.beatMap, notes: chart.notes,
  };
  const info = {
    format: SONG_INFO_FORMAT, schemaVersion: CHART_EXPORT_SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    id, title: chart.title, artist: chart.artist, durationMs, bpm: chart.bpm, timeSignature: chart.timeSignature,
    chartFingerprint: `musicxml-v1`, coverFile: null,
    charts: { A: chartFileName(stem, "A") }, difficultyLabels: { A: "beginner" },
    audioTracks: { vocals: null, others: null, bass: null }, source: "musicxml",
  };
  return [
    { name: `${stem}.info.json`, text: JSON.stringify(info, null, 2) },
    { name: chartFileName(stem, "A"), text: JSON.stringify(a, null, 2) },
  ];
}
