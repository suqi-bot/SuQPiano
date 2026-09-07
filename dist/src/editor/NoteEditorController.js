/**
 * NoteEditorController — 把音符编辑器接到应用
 *
 * 职责：
 *   - 打开：把 Recorder 当前"要编辑的音符"(editableNotes)载入 NoteTimeline，
 *     实例化 PianoRollEditor 并显示覆盖层；
 *   - 工具栏"播放"：以循环方式试听当前编辑结果（停录 demo/旧循环）；
 *   - "应用"：把 NoteTimeline 的音符写回 Recorder.setEditedNotes(...)，
 *     之后"循环播放"即播放编辑结果；退出并停掉编辑试听；
 *   - "放弃/✕"：丢弃本次改动（Recorder 数据未动）直接关闭；
 *   - "重置/清空/新建"等编辑动作在编辑器内部完成。
 *
 * 数据一致性保证：
 *   编辑过程只作用于独立的 NoteTimeline；仅当用户点"应用"才以纯 {t,d,m,v}
 *   形式写回 Recorder —— 不触碰 Recorder 的原始 on/off 事件，也不改其结构。
 */
import { NoteTimeline } from './NoteTimeline.js';
import { PianoRollEditor } from './PianoRollEditor.js';

export class NoteEditorController {
  /** @param {import('../app/PianoApp.js').PianoApp} app */
  constructor(app) {
    this.app = app;
    this.host = document.getElementById('note-editor');
    this.editor = null;
    this.timeline = null;
    this._bindToolbar();       // 静态工具栏绑定一次，避免重复累积
  }

  /** 静态工具栏按钮：每次进入把动作转发给当前 editor（不存在则忽略） */
  _bindToolbar() {
    const acts = ['play', 'undo', 'redo', 'del', 'paste', 'zoomIn', 'zoomOut', 'fit', 'apply', 'reset', 'close'];
    for (const a of acts) {
      const b = this.host.querySelector(`[data-act="${a}"]`);
      b?.addEventListener('click', () => this._toolbar(a));
    }
  }

  _toolbar(act) {
    switch (act) {
      case 'play': if (this.editor) this._audition(this.editor.tl.getNotes()); break;
      case 'undo': this.editor?.tl.undo(); break;
      case 'redo': this.editor?.tl.redo(); break;
      case 'del': this.editor?.deleteSel(); break;
      case 'paste': this.editor?.paste(); break;
      case 'zoomIn': this.editor?._act('zoomIn'); break;
      case 'zoomOut': this.editor?._act('zoomOut'); break;
      case 'fit': this.editor?._act('fit'); break;
      case 'apply': this.close({ apply: true }); break;
      case 'reset': this.close({ apply: false }); break;
      case 'close': this.close({ apply: false }); break;
    }
  }

  open() {
    const rec = this.app.recorder;
    // 停止录音/旧循环/示范曲，避免与新编辑器冲突
    if (rec.recording) rec.stopRecord();
    this.app.stopDemo();
    if (rec.playing) rec.stopPlay();

    // 确保 .pro-body 内有一张全新画布（上次 destroy 已移除它）
    const body = this.host.querySelector('.pro-body');
    if (!body.querySelector('.pro-canvas')) {
      const cv = document.createElement('canvas');
      cv.className = 'pro-canvas';
      body.appendChild(cv);
    }

    const notes = rec.editableNotes();       // 已录(或上次编辑)结果
    this.timeline = new NoteTimeline(notes);
    this.host.hidden = false;

    this.editor = new PianoRollEditor(this.host, this.timeline, {
      onPlay: (n) => this._audition(n),
      onClose: () => this.close({ apply: false }),
      clampMidi: [this.app.range.startMidi, this.app.range.endMidi],
    });

    // 画布获得焦点以接收键盘（编辑器在构造时已首绘）
    requestAnimationFrame(() => this.host.querySelector('.pro-canvas')?.focus?.());
  }

  /** 试听当前编辑结果（单次不循环）。不影响 Recorder 的播放/录制状态 */
  _audition(notes) {
    const rec = this.app.recorder;
    this.app.ensureAudio().then(() => rec.audition(notes));
  }

  close({ apply }) {
    if (apply && this.timeline) {
      // 把编辑结果写回 Recorder（纯 {t,d,m,v}）
      this.app.recorder.setEditedNotes(this.timeline.getNotes());
    }
    if (this.editor) { this.editor.destroy(); this.editor = null; }
    this.timeline = null;
    this.host.hidden = true;
  }

  toggle() { this.editor ? this.close({ apply: true }) : this.open(); }
}
