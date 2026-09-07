/**
 * make-example-mid.mjs — 生成示例 MIDI（node tools/make-example-mid.mjs）
 * 产出一个 Format 1 文件 examples/sample.mid：C 大调音阶 + 琶音，120BPM，含延音踏板。
 * 供「MIDI 文件」面板直接加载试听 / 观察琴键联动。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vlq = (n) => { const b = [n & 0x7f]; n >>= 7; while (n) { b.unshift((n & 0x7f) | 0x80); n >>= 7; } return b; };
const chars = (s) => [...s].map((c) => c.charCodeAt(0));
const chunk = (id, data) => { const len = data.length; return [...chars(id), (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...data]; };
const ev = (d, b) => [...vlq(d), ...b];
const meta = (d, t, data) => ev(d, [0xff, t, ...vlq(data.length), ...data]);

const Q = 480;                                    // 一拍 tick

// 音轨 0：导引（tempo / 拍号）
const conductor = [
  ...meta(0, 0x03, chars('Conductor')),
  ...meta(0, 0x51, [0x07, 0xa1, 0x20]),           // 120 BPM
  ...meta(0, 0x58, [4, 2, 24, 8]),                // 4/4
  ...ev(0, [0xff, 0x2f, 0x00]),
];

// 音轨 1：旋律（双手）——C 大调音阶上行 + 主和弦琶音
const scale = [60, 62, 64, 65, 67, 69, 71, 72];  // C D E F G A B C
const arp = [60, 64, 67, 72, 76, 72, 67, 64];    // 大三和弦琶音上下
const seq = [...scale, ...arp];
let t = 0;
const melody = [...meta(0, 0x03, chars('Piano')), ...meta(0, 0xc0 | 0, [0])];
seq.forEach((m, i) => {
  melody.push(...ev(i === 0 ? 0 : Q, [0x90, m, 96]));   // 每音一拍
  t += Q;
  melody.push(...ev(Q, [0x80, m, 0]));
  t += Q;
  if (i === 3) melody.push(...ev(0, [0xb0, 64, 127]));   // 中途踩下延音
  if (i === 5) melody.push(...ev(0, [0xb0, 64, 0]));     // 松开
});
melody.push(...ev(0, [0xff, 0x2f, 0x00]));

const header = chunk('MThd', [0, 1, 0, 2, (Q >> 8) & 255, Q & 255]);   // Format 1, 2 tracks
const bytes = header
  .concat(chunk('MTrk', conductor))
  .concat(chunk('MTrk', melody));

mkdirSync(join(root, 'examples'), { recursive: true });
const out = join(root, 'examples', 'sample.mid');
writeFileSync(out, Uint8Array.from(bytes));
console.log('已生成', out, bytes.length, 'bytes');
