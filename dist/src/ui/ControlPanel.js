/**
 * ControlPanel — DOM 控制面板与状态栏绑定
 * 面板结构写在 index.html 中，这里只负责事件绑定与刷新。
 */

import { DEMO_SONGS } from '../app/DemoSongs.js';
import { midiToName, isBlackKey } from '../core/NoteUtils.js';
import { formatSeconds } from '../core/MidiFile.js';
import { NoteWaterfall } from './NoteWaterfall.js';

const $ = (id) => document.getElementById(id);

export class ControlPanel {
  constructor(app) {
    this.app = app;
    this.values = { volume: 0.75, velocity: 0.85, reverb: 0.32 };
    this._lastStatus = {};
    this.waterfall = new NoteWaterfall($('wf-stream'));
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

    // ---- 三踏板：右延音 / 中持音 / 左柔音 ----
    const pedals = [
      ['btn-pedal', 0], ['btn-pedal-sostenuto', 1], ['btn-pedal-soft', 2],
    ];
    for (const [id, index] of pedals) {
      const pedal = $(id);
      if (!pedal) continue;
      pedal.addEventListener('pointerdown', (e) => {
        e.preventDefault(); pedal.setPointerCapture?.(e.pointerId); app.setPedal(index, true);
      });
      pedal.addEventListener('pointerup', (e) => { e.preventDefault(); app.setPedal(index, false); });
      pedal.addEventListener('pointercancel', () => app.setPedal(index, false));
      pedal.addEventListener('click', (e) => e.preventDefault());
    }

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

    // ---- MIDI 文件：读取 / 选轨 / 变速 / 播放（琴键自动联动）----
    const selMidi = $('sel-midi-track');
    $('midi-file')?.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      await app.ensureAudio().catch(() => {});
      this._text('midi-name', f.name);
      try {
        await app.midi.loadFile(f);
      } catch (err) {
        this._text('midi-name', 'MIDI 解析失败');
        this._text('midi-status', String((err && err.message) || err));
        console.error('[midi]', err);
      }
    });
    selMidi?.addEventListener('change', (e) => app.midi.setTrack(e.target.value));
    $('btn-midi-play')?.addEventListener('click', async () => {
      await app.ensureAudio();
      app.midi.play();
    });
    $('btn-midi-stop')?.addEventListener('click', () => app.midi.stop());
    this._slider('midi-speed', (v) => {
      this._text('midi-speed-val', Math.round(v * 100) + '%');
      app.midi.setSpeed(v);
    });

    // ---- 录制 / 循环回放 ----
    $('btn-rec')?.addEventListener('click', () => app.recorder.toggleRecord());
    $('btn-rec-play')?.addEventListener('click', async () => {
      await app.ensureAudio();
      app.recorder.play(true);
    });
    $('btn-rec-stop')?.addEventListener('click', () => app.recorder.stopPlay());
    $('btn-rec-clear')?.addEventListener('click', () => app.recorder.clear());

    // ---- 音符编辑器 ----
    $('btn-note-editor')?.addEventListener('click', async () => {
      if (!app.recorder.editableNotes().length) {
        // 无内容也允许进入，便于双击空白新建
      }
      await app.ensureAudio().catch(() => {});
      app.noteEditor.open();
    });

    // ---- 八度平移按钮 ----
    $('btn-oct-down')?.addEventListener('click', () => app.input._shiftOctave(-1));
    $('btn-oct-up')?.addEventListener('click', () => app.input._shiftOctave(1));

    // ---- 音名流清空 ----
    $('btn-wf-clear')?.addEventListener('click', () => this.waterfall?.clear());

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

  setPedalState(index, on) {
    if (typeof index === 'boolean') { on = index; index = 0; }
    const ids = ['btn-pedal', 'btn-pedal-sostenuto', 'btn-pedal-soft'];
    const labels = ['pedal-state', 'pedal-sostenuto-state', 'pedal-soft-state'];
    const el = $(ids[index]);
    if (el) el.classList.toggle('is-active', on);
    this._text(labels[index], on ? '踩下' : '松开');
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

  /** MIDI 解析完成：填充轨道列表、启用播放按钮 */
  setMidiLoaded(data, player) {
    const sel = $('sel-midi-track');
    if (sel) {
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const playable = data.notes.filter((n) => n.ch !== 9).length;
      const opts = [`<option value="all">全部轨道（${playable} 音）</option>`];
      data.tracks.forEach((tr, i) => {
        opts.push(`<option value="${i}">${i + 1}. ${esc(tr.name || ('Track ' + (i + 1)))} · ${tr.noteCount} 音</option>`);
      });
      sel.innerHTML = opts.join('');
      sel.value = player ? player.trackId : String(data.defaultTrack);
    }
    if (player) this._text('midi-name', player.fileName);
    const play = $('btn-midi-play');
    if (play) play.disabled = false;
  }

  /** MIDI 播放状态 / 进度（MidiPlayer 调用） */
  setMidiState(s) {
    const play = $('btn-midi-play'), stop = $('btn-midi-stop');
    if (s.playing !== undefined) {
      play?.classList.toggle('is-active', s.playing);
      if (play) play.textContent = s.playing ? '播放中…' : '播放';
      if (stop) stop.disabled = !s.playing;
    }
    if (s.totalSec !== undefined) this._midiTotal = s.totalSec;
    const el = $('midi-status');
    if (!el) return;
    if (s.timeSec !== undefined) {
      el.textContent = `${formatSeconds(s.timeSec)} / ${formatSeconds(this._midiTotal || 0)}`;
    } else if (s.noteCount !== undefined) {
      el.textContent = `${s.noteCount} 音 · ${formatSeconds(this._midiTotal || 0)}`;
      if (s.playing === false && play) play.disabled = s.noteCount === 0;   // 0 音（如导引轨）不可播放
    }
  }

  /** 录制 / 回放状态联动（Recorder 调用） */
  setRecorderState(state) {
    if (state.recording !== undefined) {
      const b = $('btn-rec');
      if (b) { b.textContent = state.recording ? '■ 停止录制' : '● 录制'; b.classList.toggle('is-active', state.recording); }
    }
    if (state.playing !== undefined) {
      const p = $('btn-rec-play'), s = $('btn-rec-stop');
      p?.classList.toggle('is-active', state.playing);
      if (p) p.textContent = state.playing ? '循环中…' : '循环播放';
      if (s) s.disabled = !state.playing;
    }
    if (state.count !== undefined) this._text('rec-status', `${state.count} 个`);
  }

  onNoteOn(midi, vel) {
    this._text('stat-note', midiToName(midi) + '  (' + midi + ')');
    const bar = $('stat-vel-bar');
    if (bar) bar.style.width = Math.round(vel * 100) + '%';
    this.waterfall?.push(midiToName(midi), vel, isBlackKey(midi));
  }

  updateStatus(info) {
    if (info.note) this._text('stat-note', `${info.note.name}  (${info.note.midi})`);
    if (info.octaveBase !== undefined) {
      this._text('stat-octave', `${midiToName(info.octaveBase)} ~ ${midiToName(info.octaveBase + 33)}`);
    }
    if (info.voices !== undefined) this._text('stat-voices', String(info.voices));
    if (info.fps !== undefined) this._text('stat-fps', String(info.fps));
    if (info.latency !== undefined) this._text('stat-latency', info.latency.toFixed(1) + ' ms');
  }
}
