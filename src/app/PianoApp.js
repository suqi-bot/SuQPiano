/**
 * PianoApp — 应用编排层：把 建模 / 音频 / 输入 / UI 串起来
 *
 * 音画同步策略：
 *   1. 视觉与音频由同一次 pressNote() 调用触发，不存在"两条链路"；
 *   2. AudioContext 使用 latencyHint:'interactive'，首次交互即 resume；
 *   3. 示范曲用 AudioContext 时钟提前精确调度发声，视觉用 setTimeout 对齐同一时刻；
 *   4. 琴键位移动画用 rAF 驱动，指数趋近时间常数 ~30ms，保证"即按即动"。
 */

import { SceneManager } from '../scene/SceneManager.js';
import { buildPiano } from '../scene/PianoModel.js';
import { KeyLabels } from '../scene/KeyLabels.js';
import { PianoSynth } from '../core/PianoSynth.js';
import { InputManager } from '../input/InputManager.js';
import { ControlPanel } from '../ui/ControlPanel.js';
import { DEMO_SONGS } from './DemoSongs.js';
import { Recorder } from './Recorder.js';
import { NoteEditorController } from '../editor/NoteEditorController.js';
import { midiToName } from '../core/NoteUtils.js';

export class PianoApp {
  constructor(canvas) {
    this.range = { startMidi: 28, endMidi: 108 };   // 81 键：E1 ~ C8

    this.sceneMgr = new SceneManager(canvas);
    this.piano = buildPiano({ startMidi: this.range.startMidi, endMidi: this.range.endMidi });
    this.sceneMgr.add(this.piano.group);
    this.sceneMgr.setFloorY(this.piano.bounds.floorY);

    this.synth = new PianoSynth();
    this.labels = new KeyLabels(this.piano.keys, this.piano.group);

    /** midi -> Set<source>：支持键盘/鼠标/触摸/示范曲同时按住同一个音 */
    this.held = new Map();
    this.velocityScale = 0.85;
    this.pedals = { sustain: false, sostenuto: false, soft: false };
    this.sostenutoHeld = new Set();
    this.demo = null;
    this.lastNote = null;
    this.audioReady = false;
    this.lidOpen = true;
    this._lidTarget = 1;

    this.input = new InputManager(this, this.sceneMgr, this.piano);
    this.ui = new ControlPanel(this);
    this.recorder = new Recorder(this);
    this.noteEditor = new NoteEditorController(this);

    this.sceneMgr.setView('hero', this.piano.bounds, true);
    this.labels.setOctaveBase(this.input.octaveBase);

    this._clock = (typeof performance !== 'undefined' && performance.now) ? performance : Date;
    this._lastT = this._clock.now();
    this._fpsAcc = 0; this._fpsCount = 0; this.fps = 0;

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // ---------------- 音频初始化（需用户手势） ----------------
  async ensureAudio() {
    if (this.audioReady) return;
    await this.synth.init();
    this.audioReady = true;
    this.synth.setMasterVolume(this.ui.values.volume);
    this.synth.setReverb(this.ui.values.reverb);
    this.synth.setPedal(0, this.pedals.sustain);
    this.synth.setPedal(1, this.pedals.sostenuto);
    this.synth.setPedal(2, this.pedals.soft);
    this.ui.updateStatus({ latency: this.synth.getLatencyMs() });
  }

  // ---------------- 按键核心逻辑 ----------------
  pressNote(midi, velocity, source = 'unknown', when) {
    const key = this.piano.keys.get(midi);
    if (!key) return;

    let set = this.held.get(midi);
    if (!set) { set = new Set(); this.held.set(midi, set); }
    const wasEmpty = set.size === 0;
    set.add(source);

    if (!wasEmpty) return;                       // 已有其他来源按住，不重复触发

    const vel = Math.max(0.05, Math.min(1, velocity * this.velocityScale));
    if (this.audioReady) this.synth.noteOn(midi, vel, when);

    key.target = 1;
    this.piano.setDamper(midi, true);

    this.lastNote = { midi, name: midiToName(midi), velocity: vel };
    this.ui.onNoteOn(midi, vel);
    this.recorder?.captureOn(midi, vel, source);
  }

  releaseNote(midi, source = 'unknown', when) {
    const set = this.held.get(midi);
    if (!set) return;
    set.delete(source);
    if (set.size > 0) return;                    // 还有其他来源按住

    this.recorder?.captureOff(midi, source);

    this.held.delete(midi);
    if (this.audioReady) this.synth.noteOff(midi, when);

    const key = this.piano.keys.get(midi);
    if (key) key.target = 0;
    this.piano.setDamper(midi, this.pedals.sustain || this.pedals.sostenuto && this.sostenutoHeld.has(midi));
  }

  // ---------------- 控制接口 ----------------
  /** 控制三块踏板：0 右延音、1 中持音、2 左柔音；保留 setPedal(bool) 兼容旧快捷键。 */
  setPedal(index, down) {
    if (typeof index === 'boolean') { down = index; index = 0; }
    const names = ['sustain', 'sostenuto', 'soft'];
    const name = names[index];
    if (!name) return;
    const next = !!down;
    if (this.pedals[name] === next) return;
    this.pedals[name] = next;

    if (index === 1 && next) {
      // 中踏板只锁住踩下瞬间已经发声的音，不影响之后弹奏的新音。
      this.sostenutoHeld = new Set(this.synth.voices.filter((v) => !v.released).map((v) => v.midi));
    }
    if (index === 1 && !next) this.sostenutoHeld.clear();

    if (this.audioReady) this.synth.setPedal(index, next);
    this.piano.setPedal(index, next);
    for (const midi of this.piano.keys.keys()) {
      const held = this.held.has(midi);
      const latched = this.pedals.sostenuto && this.sostenutoHeld.has(midi);
      this.piano.setDamper(midi, held || this.pedals.sustain || latched);
    }
    this.ui.setPedalState(index, next);
  }

  setVelocityScale(v) { this.velocityScale = v; }

  setLabelMode(mode) { this.labels.show(mode); }

  setView(name) {
    this.sceneMgr.setView(name, this.piano.bounds);
    this.ui.setViewName(name);
  }

  toggleLid() {
    this.lidOpen = !this.lidOpen;
    this._lidTarget = this.lidOpen ? 1 : 0;
    this.ui.setLidState(this.lidOpen);
  }

  onOctaveChanged(base) { this.labels.setOctaveBase(base); }

  panic() {
    for (const [midi, set] of [...this.held]) {
      for (const s of set) this.releaseNote(midi, s);
    }
    this.held.clear();
    this.input.keyboardNotes.clear();
    this.input.pointerNotes.clear();
    this.synth.allNotesOff();
    this.setPedal(0, false);
    this.setPedal(1, false);
    this.setPedal(2, false);
  }

  // ---------------- 示范曲 ----------------
  playDemo(id) {
    if (!this.audioReady) return;
    this.stopDemo();
    const song = DEMO_SONGS.find((s) => s.id === id);
    if (!song) return;

    const ctx = this.synth.ctx;
    const t0 = ctx.currentTime + 0.3;
    const timers = [];

    for (const ev of song.events) {
      const when = t0 + ev.t;
      const delayMs = Math.max(0, (when - ctx.currentTime) * 1000);
      // 音频按 AudioContext 时钟精确调度（节奏绝对准确），视觉用定时器对齐同一时刻
      timers.push(setTimeout(() => this.pressNote(ev.m, ev.v, 'demo', when), delayMs));
      timers.push(setTimeout(() => this.releaseNote(ev.m, 'demo', when + ev.d), delayMs + ev.d * 1000));
    }
    const endMs = Math.max(...song.events.map((e) => e.t + e.d)) * 1000 + 900;
    timers.push(setTimeout(() => {
      if (this.demo && this.demo.id === id) { this.demo = null; this.ui.setDemoPlaying(false); }
    }, endMs));

    this.demo = { id, timers };
    this.ui.setDemoPlaying(true);
  }

  stopDemo() {
    if (!this.demo) return;
    for (const t of this.demo.timers) clearTimeout(t);
    for (const [midi, set] of [...this.held]) {
      if (set.has('demo')) this.releaseNote(midi, 'demo');
    }
    this.demo = null;
    this.ui.setDemoPlaying(false);
  }

  // ---------------- 主循环 ----------------
  _loop() {
    requestAnimationFrame(this._loop);
    const now = this._clock.now();
    const dt = Math.min(0.05, (now - this._lastT) / 1000);
    this._lastT = now;

    // 顶盖开合动画
    if (this._lidTarget !== undefined) {
      const cur = this.piano.lidProgress;
      const diff = this._lidTarget - cur;
      if (Math.abs(diff) > 0.001) {
        this.piano.updateLid(cur + diff * (1 - Math.exp(-dt * 4.5)));
      }
    }

    this.piano.update(dt);
    this.sceneMgr.update(dt);
    this.sceneMgr.render();

    this._fpsAcc += dt; this._fpsCount++;
    if (this._fpsAcc > 0.5) {
      this.fps = Math.round(this._fpsCount / this._fpsAcc);
      this._fpsAcc = 0; this._fpsCount = 0;
    }
    this.ui.updateStatus({
      fps: this.fps,
      voices: this.synth.activeVoiceCount,
      latency: this.audioReady ? this.synth.getLatencyMs() : 0,
      note: this.lastNote,
      octaveBase: this.input.octaveBase,
    });
  }
}
