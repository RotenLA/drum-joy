import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { parseMusicXmlDrums } from "../src/shared/musicXmlChart";

const head = `<score-partwise><part-list><score-part id="P1"><score-instrument id="P1-I1"><instrument-name>Snare (hit)</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-unpitched>39</midi-unpitched></midi-instrument></score-part></part-list><part id="P1">`;
const n = (dur: number, extra = "") => `<note>${extra}<unpitched/><duration>${dur}</duration><instrument id="P1-I1"/></note>`;

describe("MusicXML 鼓谱 1:1 转换", () => {
  it("按 BPM 与 divisions 算出毫秒，和弦同刻", () => {
    const xml = head + `<measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><sound tempo="60"/>${n(2)}${n(2, "<chord/>")}${n(1)}<note><rest/><duration>5</duration></note></measure></part></score-partwise>`;
    const c = parseMusicXmlDrums(xml);
    expect(c.notes.map((x) => x.timeMs)).toEqual([0, 0, 1000]);
    expect(c.notes[0]!.midiNote).toBe(38); // midi-unpitched 1 起计
    expect(c.durationMs).toBe(4000);
    expect(c.beatMap.beats).toEqual([0, 1000, 2000, 3000]);
  });
  it("上传的 2-4.xml：72 个闭镲、33 小节", () => {
    const p = "/mnt/user-uploads/2-4.xml";
    if (!existsSync(p)) return;
    const c = parseMusicXmlDrums(readFileSync(p, "utf8"));
    expect(c.notes.filter((n) => n.midiNote === 42).length).toBe(72);
    expect(c.notes.filter((n) => n.midiNote === 44).length).toBe(10);
    expect(c.notes.every((x) => x.midiNote === 42 || x.midiNote === 44)).toBe(true);
    expect(c.notes[0]!.timeMs).toBe(6575);
    expect(c.measureCount).toBe(33);
    expect(c.beatMap.beats.length).toBe(132);
    expect(c.bpm).toBe(73);
  });
});

import { addPedalHolds } from "../src/shared/musicXmlChart";
it("closed hats get 44 holds, released before open hat", () => {
  const n = [0, 500, 1000, 1500].map((t) => ({ timeMs: t, midiNote: 42 }));
  n.push({ timeMs: 2000, midiNote: 46 }, { timeMs: 2500, midiNote: 42 });
  const out = addPedalHolds(n, 500, 4).filter((x) => x.midiNote === 44);
  expect(out).toEqual([{ timeMs: 0, midiNote: 44, holdMs: 1750 }, { timeMs: 2500, midiNote: 44, holdMs: 250 }]);
});
