/**
 * ControlPanel — DOM 控制面板与状态栏绑定
 * 面板结构写在 index.html 中，这里只负责事件绑定与刷新。
 */

import { DEMO_SONGS } from '../app/DemoSongs.js';
import { midiToName } from '../core/NoteUtils.js';

const $ = (id) => document.getElementById(id);

export class ControlPanel {
  constructor(app) {
    this.app = app;
    this.values = { volume: 0.75, velocity: 0.85, reverb: 0.32 };
    this._lastStatus = {};
    this._build();
  }

  _build() {
    const app = this.app;

    // ---- 示范曲下拉 ----
    const selDemo = $('sel-demo');
    if (selDemo) {
      selDemo.innerHTML = DEMO_SONGS
        .map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    }

    // ---- 音量 ----
    this._slider('volume', (v) => {
      this.values.volume = v;
      if (app.audioReady) app.synth.setMasterVolume(v);
      this._text('volume-val', Math.round(v * 100) + '%');
    });

    // ---- 触键力度 ----
    this._slider('velocity', (v) => {
      this.values.velocity = v;
      app.setVelocityScale(v);
      this._text('velocity-val', Math.round(v * 100) + '%');
    });

    // ---- 混响 ----
    this._slider('reverb', (v) => {
      this.values.reverb = v;
      if (app.audioReady) app.synth.setReverb(v);
      this._text('reverb-val', Math.round(v * 100) + '%');
    });

    // ---- 延音踏板 ----
    const pedal = $('btn-pedal');
    pedal?.addEventListener('pointerdown', (e) => { e.preventDefault(); app.setPedal(true); });
    window.addEventListener('pointerup', () => app.setPedal(false));
    pedal?.addEventListener('click', (e) => e.preventDefault());

    // ---- 标签模式 ----
    $('sel-label')?.addEventListener('change', (e) => app.setLabelMode(e.target.value));

    // ---- 视角 ----
    $('sel-view')?.addEventListener('change', (e) => app.setView(e.target.value));

    // ---- 琴盖 ----
    $('btn-lid')?.addEventListener('click', () => app.toggleLid());

    // ---- 示范曲播放 / 停止 ----
    $('btn-demo-play')?.addEventListener('click', async () => {
      await app.ensureAudio();
      app.playDemo(selDemo?.value || DEMO_SONGS[0].id);
    });
    $('btn-demo-stop')?.addEventListener('click', () => app.stopDemo());

    // ---- 八度平移按钮 ----
    $('btn-oct-down')?.addEventListener('click', () => app.input._shiftOctave(-1));
    $('btn-oct-up')?.addEventListener('click', () => app.input._shiftOctave(1));

    // ---- 初始化文本 ----
    ['volume', 'velocity', 'reverb'].forEach((k) => {
      const el = $(k);
      if (el) { el.value = String(this.values[k]); el.dispatchEvent(new Event('input')); }
    });
  }

  _slider(id, cb) {
    const el = $(id);
    if (!el) return;
    const handler = () => cb(parseFloat(el.value));
    el.addEventListener('input', handler);
    handler();
  }

  _text(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  setPedalState(on) {
    const el = $('btn-pedal');
    if (el) el.classList.toggle('is-active', on);
    this._text('pedal-state', on ? '踩下' : '松开');
  }

  setLidState(open) {
    const el = $('btn-lid');
    if (el) { el.textContent = open ? '关闭琴盖' : '打开琴盖'; el.classList.toggle('is-active', open); }
  }

  setViewName(name) {
    const el = $('sel-view');
    if (el && el.value !== name) el.value = name;
  }

  setDemoPlaying(playing) {
    const p = $('btn-demo-play'), s = $('btn-demo-stop');
    p?.classList.toggle('is-active', playing);
    if (p) p.textContent = playing ? '播放中…' : '播放';
    if (s) s.disabled = !playing;
  }

  onNoteOn(midi, vel) {
    this._text('stat-note', midiToName(midi) + '  (' + midi + ')');
    const bar = $('stat-vel-bar');
    if (bar) bar.style.width = Math.round(vel * 100) + '%';
  }

  updateStatus(info) {
    if (info.note) this._text('stat-note', `${info.note.name}  (${info.note.midi})`);
    if (info.octaveBase !== undefined) {
      this._text('stat-octave', `${midiToName(info.octaveBase)} ~ ${midiToName(info.octaveBase + 28)}`);
    }
    if (info.voices !== undefined) this._text('stat-voices', String(info.voices));
    if (info.fps !== undefined) this._text('stat-fps', String(info.fps));
    if (info.latency !== undefined) this._text('stat-latency', info.latency.toFixed(1) + ' ms');
  }
}
