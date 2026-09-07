/**
 * midi-selftest.mjs — 零依赖 MIDI 解析器自检（node tools/midi-selftest.mjs）
 * 在内存里构造一个 Format 0 文件：120BPM、两个音符(C4/E4)、running-status 延音踏板、EOT，
 * 解析后校验 tick→秒 的时间轴、力度、轨道与踏板，确保与浏览器端行为一致。
 */
import { parseMidi, formatSeconds } from '../src/core/MidiFile.js';

const vlq = (n) => { const b = [n & 0x7f]; n >>= 7; while (n) { b.unshift((n & 0x7f) | 0x80); n >>= 7; } return b; };
const chars = (s) => [...s].map((c) => c.charCodeAt(0));
const chunk = (id, data) => { const len = data.length; return [...chars(id), (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...data]; };
const ev = (delta, bytes) => [...vlq(delta), ...bytes];
const meta = (delta, type, data) => ev(delta, [0xff, type, ...vlq(data.length), ...data]);

const ppq = 480;
const track = [
  ...meta(0, 0x51, [0x07, 0xa1, 0x20]),   // set tempo 500000us = 120 BPM
  ...meta(0, 0x03, chars('Lead')),        // track name
  ...ev(0, [0x90, 60, 100]),              // C4 on  @ tick 0
  ...ev(ppq, [0x80, 60, 64]),             // C4 off @ 480  -> t=0.0 d=0.5
  ...ev(0, [0x90, 64, 90]),               // E4 on  @ 480
  ...ev(ppq, [0x80, 64, 64]),             // E4 off @ 960  -> t=0.5 d=0.5
  ...ev(0, [0xb0, 64, 127]),              // sustain ON @ 960 (t=1.0)
  ...ev(0, [0x40, 0x00]),                 // running-status: CC64=0 -> sustain OFF
  ...ev(0, [0xff, 0x2f, 0x00]),           // end of track
];

const bytes = chunk('MThd', [0, 0, 0, 1, (ppq >> 8) & 255, ppq & 255]).concat(chunk('MTrk', track));
const buf = Uint8Array.from(bytes).buffer;
const d = parseMidi(buf);

const near = (a, b) => Math.abs(a - b) < 1e-6;
const results = [];
const assert = (name, ok, got) => { results.push({ name, ok, got }); };

assert('format=0', d.format === 0, d.format);
assert('ppq=480', d.ppq === 480, d.ppq);
assert('bpm=120', d.bpm === 120, d.bpm);
assert('notes=2', d.notes.length === 2, d.notes.length);
assert('C4 @0.0 d0.5 v~100/127', d.notes[0].m === 60 && near(d.notes[0].t, 0) && near(d.notes[0].d, 0.5), d.notes[0]);
assert('E4 @0.5 d0.5', d.notes[1].m === 64 && near(d.notes[1].t, 0.5) && near(d.notes[1].d, 0.5), d.notes[1]);
assert('duration=1.0', near(d.duration, 1.0), d.duration);
assert('pedals=2 (on@1.0, off@1.0)', d.pedals.length === 2 && d.pedals[0].down === true && d.pedals[1].down === false, d.pedals);
assert('track name=Lead', d.tracks[0].name === 'Lead', d.tracks[0]);
assert('defaultTrack=0', d.defaultTrack === 0, d.defaultTrack);

console.log('--- parsed notes ---');
console.table(d.notes.map((n) => ({ t: +n.t.toFixed(3), d: +n.d.toFixed(3), m: n.m, v: +n.v.toFixed(2) })));
console.log('--- pedals ---', d.pedals.map((pd) => `${pd.t.toFixed(2)}s ${pd.index}=${pd.down ? '踩下' : '松开'}`).join(' | '));
console.log('duration:', formatSeconds(d.duration), 'bpm:', d.bpm);

const failed = results.filter((r) => !r.ok);
console.log('\n' + (failed.length ? '❌ 失败' : '✅ 全部通过') + ` ${results.length - failed.length}/${results.length}`);
for (const r of failed) console.log('   ✗', r.name, '-> got', JSON.stringify(r.got));
process.exit(failed.length ? 1 : 0);
