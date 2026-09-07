/**
 * midi-playtest.mjs — MIDI 播放器联动自检（node tools/midi-playtest.mjs）
 *
 * 用「假 app」捕获 MidiPlayer 的调用，验证：
 *   - 载入即选中默认轨道、以 source='midi' 发射 pressNote/releaseNote；
 *   - 力度归一到 0~1；延音踏板(CC64) → app.setPedal(0,true/false)；
 *   - 超范围音 A0(21) 被八度折叠进 28~108（→33）；
 *   - 中途 stop() 会释放仍在响的 midi 音、并复位 MIDI 踩下的踏板。
 * 真实浏览器里 pressNote 内部即驱动 3D 琴键下沉 + 制音器 + 音名流，联动由此保证。
 */
import { MidiPlayer } from '../src/app/MidiPlayer.js';

// ---- 构造一个含多音、踏板、超范围音的 Format 0 MIDI（120BPM，1 拍=0.5s，ppq=480）----
const vlq = (n) => { const b = [n & 0x7f]; n >>= 7; while (n) { b.unshift((n & 0x7f) | 0x80); n >>= 7; } return b; };
const chars = (s) => [...s].map((c) => c.charCodeAt(0));
const chunk = (id, data) => { const len = data.length; return [...chars(id), (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...data]; };
const ev = (d, b) => [...vlq(d), ...b];
const meta = (d, t, data) => ev(d, [0xff, t, ...vlq(data.length), ...data]);
const Q = 480;                                   // 一拍 tick
const track = [
  ...meta(0, 0x51, [0x07, 0xa1, 0x20]),          // 120 BPM
  ...meta(0, 0x03, chars('Melody')),
  ...ev(0, [0x90, 60, 100]), ...ev(Q, [0x80, 60, 0]),         // C4  on0.0 off0.5
  ...ev(0, [0x90, 64, 90]),  ...ev(Q, [0x80, 64, 0]),         // E4  on0.5 off1.0
  ...ev(0, [0x90, 21, 80]),  ...ev(Q, [0x80, 21, 0]),         // A0  on1.0 off1.5（越界→33）
  ...ev(0, [0xb0, 64, 127]),                                   // sustain ON @1.5
  ...ev(0, [0x90, 67, 110]), ...ev(Q, [0x80, 67, 0]),         // G4  on1.5 off2.0
  ...ev(0, [0xb0, 64, 0]),                                     // sustain OFF @2.0
  ...ev(0, [0xff, 0x2f, 0x00]),
];
const bytes = chunk('MThd', [0, 0, 0, 1, (Q >> 8) & 255, Q & 255]).concat(chunk('MTrk', track));
const buffer = Uint8Array.from(bytes).buffer;

// ---- 假 app：记录所有联动调用 ----
let log = [];
const app = {
  synth: { ctx: { currentTime: 0 } },
  pressNote: (m, v, src, when) => log.push({ kind: 'on', m, v, src, when }),
  releaseNote: (m, src, when) => log.push({ kind: 'off', m, src, when }),
  setPedal: (i, d) => log.push({ kind: 'pedal', i, d }),
  ui: { setMidiLoaded() {}, setMidiState() {} },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ons = () => log.filter((x) => x.kind === 'on');
const offs = () => log.filter((x) => x.kind === 'off');
const pedals = () => log.filter((x) => x.kind === 'pedal');

const results = [];
const assert = (name, ok, got) => results.push({ name, ok, got });

const player = new MidiPlayer(app);
const data = player.load(buffer, 'test.mid');
assert('载入后默认轨道=0', player.trackId === '0', player.trackId);
assert('解析出 4 个音符', data.notes.length === 4, data.notes.length);

// ===== 阶段 A：完整播放（前导 0.25s + 末音 2.0s + 收尾 → 覆盖到 ~2.85s）=====
player.play();
await sleep(3100);

assert('C4 以 source=midi 按下', ons().some((x) => x.m === 60 && x.src === 'midi'), ons().map((x) => x.m));
assert('E4/G4 均按下', [64, 67].every((m) => ons().some((x) => x.m === m)), ons().map((x) => x.m));
assert('力度归一 0~1', ons().every((x) => x.v > 0 && x.v <= 1), ons().map((x) => +x.v.toFixed(2)));
assert('A0(21) 折叠为 33', ons().some((x) => x.m === 33) && !ons().some((x) => x.m === 21), ons().map((x) => x.m));
assert('全部落在音域 28~108', ons().every((x) => x.m >= 28 && x.m <= 108), ons().map((x) => x.m));
assert('延音踩下 setPedal(0,true)', pedals().some((x) => x.i === 0 && x.d === true), pedals());
assert('延音松开 setPedal(0,false)', pedals().some((x) => x.i === 0 && x.d === false), pedals());
assert('每个按下都有对应松开（自然收尾）', offs().length === ons().length, { on: ons().length, off: offs().length });

// ===== 阶段 B：中途 stop 释放（C4 在 250ms 按下、500ms 才松开 → 于 ~350ms 停止）=====
log = [];
player.play();
await sleep(350);
const heldAfterOn = ons().some((x) => x.m === 60) && !offs().some((x) => x.m === 60);
player.stop();
assert('stop 前 C4 正在响', heldAfterOn, { on: ons().map((x) => x.m), off: offs().map((x) => x.m) });
assert('stop 释放了 C4', offs().some((x) => x.m === 60 && x.src === 'midi'), offs().map((x) => x.m));
assert('stop 后 playing=false', player.playing === false, player.playing);

const failed = results.filter((r) => !r.ok);
console.log('阶段 A 联动日志（m=音高 / kind / src）:');
console.table(log.map((x) => x.kind === 'pedal' ? { kind: 'pedal', detail: `#${x.i}=${x.d ? '踩下' : '松开'}` } : { kind: x.kind, m: x.m, src: x.src }));
console.log('\n' + (failed.length ? '❌ 失败' : '✅ 全部通过') + ` ${results.length - failed.length}/${results.length}`);
for (const r of failed) console.log('   ✗', r.name, '-> got', JSON.stringify(r.got));
process.exit(failed.length ? 1 : 0);
