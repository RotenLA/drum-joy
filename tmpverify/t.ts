import { buildPlayChart } from "../src/taiko/difficulty";
import { extractGrooves } from "../src/taiko/patterns";
import { analyzeMidi } from "../src/taiko/difficulty";
import type { ParsedMidi } from "../src/taiko/midiFile";

const ppq = 480, bpm = 140, spq = 60000/bpm;
const notes: any[] = [];
const push = (tick:number, note:number, vel:number, jitter=0)=>{
  const timeMs = (tick/ppq)*spq + jitter;
  notes.push({tick, timeMs, note, velocity: vel, channel: 9});
};
// 32 bars funk-ish: kick 0 & 1.5beat, snare 2&4, hat 8ths, plus AI noise
for (let bar=0; bar<32; bar++){
  const b0 = bar*4*ppq;
  const j = () => (Math.random()*30-15); // AI 抖动
  push(b0, 36, 110, j());
  push(b0 + ppq*1.5, 36, 100, j());
  push(b0 + ppq*2, 38, 108, j());
  push(b0 + ppq*3.5, 38, 95, j());
  for (let e=0;e<8;e++) push(b0 + e*ppq/2, 42, 80, j());
  // 杂音：极弱残响 + 双触发 + 串音通鼓
  push(b0 + ppq*2 + 20, 38, 96, 0);     // 双触发（20ms 内）
  push(b0 + ppq*1, 45, 22, 0);          // 极弱通鼓串音
  push(b0 + ppq*2, 48, 60, 0);          // 与军鼓+踩镲同刻的第三件
}
const midi: ParsedMidi = {
  ppq, tempos:[{tick:0, usPerQuarter: 60000000/bpm, timeMs:0}],
  timeSignatures:[{tick:0,numerator:4,denominator:4}],
  notes: notes.sort((a,b)=>a.tick-b.tick),
  durationMs: (32*4*ppq/ppq)*spq, bpm, timeSignature:[4,4],
};
const { clean, skeleton } = analyzeMidi(midi);
console.log("原始音符", midi.notes.length, "清洗后", clean.hits.length);
console.log("律动型", JSON.stringify(extractGrooves(skeleton, 4)));
for (const d of ["easy","beginner","standard","hard"] as const){
  const c = buildPlayChart(midi, {title:"t"}, d);
  const first = c.notes.slice(0,6).map(n=>Math.round(n.timeMs));
  // 与网格偏差
  const step = spq/4;
  const dev = c.notes.map(n=> Math.abs(n.timeMs - Math.round(n.timeMs/step)*step));
  console.log(d, "音符", c.notes.length, "最大偏差ms", Math.round(Math.max(...dev)), first);
}
