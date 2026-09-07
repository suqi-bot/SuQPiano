/**
 * MidiPlayer — 读取到的 MIDI 的播放引擎（琴键实时联动）
 *
 * 与 Recorder / playDemo 同构：把 { t, d, m, v } 事件用 setTimeout 对齐视觉、
 * 用 AudioContext 绝对时钟 when 对齐发声，统一以 source='midi' 走
 * PianoApp.pressNote/releaseNote —— 因此按下任意一个音，3D 琴键都会自动下沉、
 * 制音器抬起、音名流刷新，无需任何额外联动代码。
 *
 * 额外能力：轨道选择、变速播放、延音/持音/柔音踏板(CC)还原、超范围音的八度折叠。
 */

import { parseMidi } from '../core/MidiFile.js';
import { RANGE_81 } from '../core/NoteUtils.js';

/** 收尾静音（秒），最后一个音结束后再释放，听感不突兀 */
const TAIL = 0.35;

export class MidiPlayer {
  constructor(app) {
    this.app = app;
    this.data = null;
    this.fileName = '';
    this.trackId = 'all';
    this.speed = 1;
    this.playing = false;

    this._timers = [];
    this._held = new Set();               // 正在发声的 midi（用于停止时统一释放）
    this._midiPedals = new Set();         // 由 MIDI 踩下的踏板索引（停止时复位）
    this._token = 0;
    this._progressTimer = null;
    this._startAt = 0;
    this._songDuration = 0;
  }

  // ---------------- 载入 ----------------
  async loadFile(file) {
    const buf = await file.arrayBuffer();
    return this.load(buf, file.name || 'untitled.mid');
  }

  load(arrayBuffer, name = 'untitled.mid') {
    this.stop();
    const data = parseMidi(arrayBuffer);
    if (!data.notes.length) throw new Error('该 MIDI 文件没有可演奏的音符');
    this.data = data;
    this.fileName = name;
    this.trackId = String(data.defaultTrack);        // 默认选旋律最丰富的轨道
    this.app.ui?.setMidiLoaded?.(data, this);
    this._emitInfo();
    return data;
  }

  setTrack(id) {
    this.trackId = id;
    if (this.playing) this.play();                    // 播放中换轨 → 从头按新轨重放
    else this._emitInfo();
  }

  setSpeed(v) {
    this.speed = v;
    if (this.playing) this.play();                    // 播放中变速 → 立即按新速度重放
    else this._emitInfo();
  }

  /** 当前选择的音符 / 踏板 / 时长（秒，未变速） */
  _selection() {
    const d = this.data;
    if (!d) return { notes: [], pedals: [], duration: 0 };
    let notes, pedals;
    if (this.trackId === 'all') {
      notes = d.notes.filter((n) => n.ch !== 9);      // 全部轨道时滤掉打击乐通道，避免噪声
      pedals = d.pedals;
    } else {
      const ti = parseInt(this.trackId, 10);
      notes = d.notes.filter((n) => n.track === ti);
      pedals = d.pedals.filter((p) => p.track === ti);
    }
    const duration = notes.reduce((m, n) => Math.max(m, n.t + n.d), 0);
    return { notes, pedals, duration };
  }

  // ---------------- 播放 / 停止 ----------------
  play() {
    if (!this.data || !this.app.synth.ctx) return;
    this.stop();
    const { notes, pedals, duration } = this._selection();
    if (!notes.length) return;

    this.playing = true;
    const token = ++this._token;
    const ctx = this.app.synth.ctx;
    const speed = this.speed || 1;
    const t0 = ctx.currentTime + 0.25;

    for (const n of notes) {
      const midi = this._fold(n.m);
      if (midi === null) continue;
      const when = t0 + n.t / speed;
      const dur = Math.max(0.05, n.d / speed);
      const delay = Math.max(0, (when - ctx.currentTime) * 1000);
      this._timers.push(setTimeout(() => {
        if (token !== this._token) return;
        this.app.pressNote(midi, n.v, 'midi', when);
        this._held.add(midi);
      }, delay));
      this._timers.push(setTimeout(() => {
        if (token !== this._token) return;
        this.app.releaseNote(midi, 'midi', when + dur);
        this._held.delete(midi);
      }, delay + dur * 1000));
    }

    for (const pd of pedals) {
      const when = t0 + pd.t / speed;
      const delay = Math.max(0, (when - ctx.currentTime) * 1000);
      this._timers.push(setTimeout(() => {
        if (token !== this._token) return;
        this.app.setPedal(pd.index, pd.down);
        if (pd.down) this._midiPedals.add(pd.index); else this._midiPedals.delete(pd.index);
      }, delay));
    }

    const totalSec = duration / speed;
    this._songDuration = duration;
    this._startAt = performance.now();
    this._progressTimer = setInterval(() => this._tickProgress(), 120);
    this._timers.push(setTimeout(() => { if (token === this._token) this._finish(); }, (totalSec + TAIL) * 1000));

    this._emitState({ playing: true, totalSec: duration });
  }

  stop() {
    this._token++;
    for (const id of this._timers) clearTimeout(id);
    this._timers = [];
    if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }
    for (const m of this._held) this.app.releaseNote(m, 'midi');
    this._held.clear();
    const wasPlaying = this.playing;
    for (const idx of this._midiPedals) this.app.setPedal(idx, false);   // 只复位 MIDI 踩下的踏板
    this._midiPedals.clear();
    if (wasPlaying) { this.playing = false; this._emitState({ playing: false }); }
  }

  _finish() {
    this.playing = false;
    this._emitState({ timeSec: this._songDuration, totalSec: this._songDuration, frac: 1 });
    this.stop();
  }

  _tickProgress() {
    const elapsed = performance.now() - this._startAt;
    const songTime = Math.min(this._songDuration, (elapsed / 1000) * (this.speed || 1));
    const frac = this._songDuration > 0 ? Math.min(1, songTime / this._songDuration) : 0;
    this._emitState({ timeSec: songTime, totalSec: this._songDuration, frac });
  }

  /** 超范围音按八度折叠进 81 键音域（保留音名，便于仍能看见 / 听见） */
  _fold(m) {
    let x = m;
    const { start, end } = RANGE_81;
    while (x < start) x += 12;
    while (x > end) x -= 12;
    return (x >= start && x <= end) ? x : null;
  }

  // ---------------- UI 桥接 ----------------
  _emitState(s) { this.app.ui?.setMidiState?.(s); }

  _emitInfo() {
    if (!this.data) return;                         // 未载入时不刷新状态，保留占位文本
    const { notes, duration } = this._selection();
    this.app.ui?.setMidiState?.({
      playing: this.playing,
      totalSec: duration,
      noteCount: notes.length,
    });
  }
}
