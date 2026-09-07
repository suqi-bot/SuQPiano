/**
 * Recorder — 录制演奏并循环回放
 *
 * 录制：通过 PianoApp.pressNote / releaseNote 的钩子采集每个音的
 *   按下(on) / 抬起(off) 事件及时间戳（秒，相对录制起点）。
 *   自身回放(source='rec')不会被二次录制，避免反馈环路。
 * 回放：把 on/off 配成 { t, d, m, v } 事件（与示范曲同格式），
 *   用 setTimeout 对齐视觉、用 AudioContext 时钟对齐发声，可循环。
 *
 * 与 playDemo 的差异：这里录的是"真实弹过的音符"，而不是写死的曲谱；
 * 回放源统一标记为 'rec'，PianoApp 的 held 集合据此支持与手动演奏叠加。
 */

/** 回放末尾的收尾静音（秒），让循环听感自然、不突兀 */
const TAIL = 0.28;

export class Recorder {
  constructor(app) {
    this.app = app;
    this.recording = false;
    this.playing = false;
    this.loop = true;
    this.autoStop = true;                   // 最后一个音松开即自动结束录制
    this.events = [];                       // 原始事件 { t, midi, v, type:'on'|'off' }，t 相对首个音符
    /** 可选：编辑器应用后的音符（{t,d,m,v}）。若设置了它，play() 直接用它，
     *  不再从 events 现场编译 —— 即"循环回放编辑结果"。沿用既有结构，格式不破坏。 */
    this.editedNotes = null;
    this._t0 = null;                        // 首个音符的时刻(=0)；null=尚未弹第一个音
    this._held = new Map();                 // 录制中：midi -> 按下时刻(秒)
    this._timers = [];                      // 回放定时器
    this._loopTimer = null;
    this._recHeld = new Set();              // 回放中正在响的音
    this._token = 0;                        // 失效令牌，stop 后让待执行回调作废
  }

  // ---------------- 采集（由 PianoApp 调用） ----------------
  /**
   * 事件统一存"相对首个音符"的时间。首个音符出现时把该时刻定为 t0=0，
   * 因此点"录制"后、第一个音按下前那段等待不会成为录音开头的空白——
   * 录音长度从第一个音真正响起开始算。
   */
  _eventT() {
    return (performance.now() - this._t0) / 1000;
  }

  _onFirstNote() {
    if (this._t0 !== null) return;
    // 记录首个音符的墙钟时刻作为整段录音的时间零点（录音从这里开始算）
    this._t0 = performance.now();
  }

  captureOn(midi, vel, source) {
    if (!this.recording || source === 'rec') return;
    this._onFirstNote();
    const t = this._eventT();
    this.events.push({ t, midi, v: vel, type: 'on' });
    this._held.set(midi, t);
  }

  captureOff(midi, source) {
    if (!this.recording || source === 'rec') return;
    if (this._t0 === null) return;           // 还没弹过任何音，忽略
    const t = this._eventT();
    this.events.push({ t, midi, v: 0, type: 'off' });
    this._held.delete(midi);
    // 最后一个音松开后没有别的音再响 → 立即自动结束录制
    if (this.autoStop && this._held.size === 0) this.stopRecord();
  }

  // ---------------- 录制控制 ----------------
  toggleRecord() { this.recording ? this.stopRecord() : this.startRecord(); }

  startRecord() {
    if (this.playing) this.stopPlay();
    this.events = [];
    this._held.clear();
    this._t0 = null;                         // 尚未弹第一个音，零点待首个音符确定
    this.recording = true;
    this._emit({ recording: true, playing: false, count: 0 });
  }

  stopRecord() {
    if (!this.recording) return;
    // 若一个音都没弹过，则无有效录音
    const t0 = this._t0;
    this.recording = false;
    if (t0 === null) {
      this._emit({ recording: false, count: 0 });
      return;
    }
    // 仍按住的音：以"相对首个音符"的现在时刻作为其自然结束点；_compile 会再修剪
    const end = (performance.now() - t0) / 1000;
    for (const [midi] of this._held) this.events.push({ t: end, midi, v: 0, type: 'off' });
    this._held.clear();
    this._emit({ recording: false, count: this._compile().length });
  }

  clear() {
    this.stopPlay();
    this.events = [];
    this._t0 = null;
    this._emit({ recording: false, playing: false, count: 0 });
  }

  // ---------------- 回放 ----------------
  /**
   * 回放音源：若存在编辑结果(editedNotes)则用之；否则现场编译录制事件。
   * 两者都输出 {t,d,m,v} 结构，因此编辑不会破坏既有回放/循环数据格式。
   */
  _sourceNotes() {
    if (this.editedNotes && this.editedNotes.length) return this.editedNotes;
    return this._compile();
  }

  /** 由音符编辑器"应用"修改后的音符集（已去除 id，纯 {t,d,m,v}） */
  setEditedNotes(notes) {
    this.editedNotes = notes ? notes.map((n) => ({ t: n.t, d: n.d, m: n.m, v: n.v ?? 0.8 })) : null;
    this._compiledEnd = this._sourceNotes().reduce((a, n) => Math.max(a, n.t + n.d), 0);
    this._emit({ count: this._sourceNotes().length });
  }

  /** 编辑器需要"此刻要编辑的音符"：编辑结果优先，否则取现场编译 */
  editableNotes() { return this._sourceNotes(); }

  play(loop = true) {
    const notes = this._sourceNotes();
    if (!notes.length) return;
    this.stopPlay();
    this.playing = true;
    this.loop = loop;
    // 循环周期 = 乐曲可见内容（不含停顿静音）+ 收尾静音；period > 0 才可循环
    const total = Math.max(this.duration, 0.01);
    const token = ++this._token;

    const schedule = () => {
      if (token !== this._token) return;
      // 清理上一轮残留
      for (const m of this._recHeld) this.app.releaseNote(m, 'rec');
      this._recHeld.clear();

      const ctx = this.app.synth.ctx;
      const t0 = ctx.currentTime + 0.25;
      for (const n of notes) {
        const when = t0 + n.t;
        const delay = Math.max(0, (when - ctx.currentTime) * 1000);
        this._timers.push(setTimeout(() => {
          if (token !== this._token) return;
          this.app.pressNote(n.m, n.v, 'rec', when);
          this._recHeld.add(n.m);
        }, delay));
        this._timers.push(setTimeout(() => {
          if (token !== this._token) return;
          this.app.releaseNote(n.m, 'rec', when + n.d);
          this._recHeld.delete(n.m);
        }, delay + n.d * 1000));
      }
      if (loop) this._loopTimer = setTimeout(() => { if (token === this._token) schedule(); }, total * 1000);
    };

    schedule();
    this._emit({ playing: true, recording: false, count: notes.length });
  }

  stopPlay() {
    this._token++;
    for (const id of this._timers) clearTimeout(id);
    this._timers = [];
    if (this._loopTimer) { clearTimeout(this._loopTimer); this._loopTimer = null; }
    for (const m of this._recHeld) this.app.releaseNote(m, 'rec');
    this._recHeld.clear();
    if (this.playing) { this.playing = false; this._emit({ playing: false }); }
  }

  /**
   * 试听一次（不进入循环、不改 playing 状态），供编辑器"播放"按钮使用。
   * 传任意 {t,d,m,v} 列表即可，复用与 play 相同的声音调度。
   */
  audition(notes) {
    if (!notes || !notes.length) return;
    this.stopPlay();
    const token = ++this._token;
    const ctx = this.app.synth.ctx;
    const t0 = ctx.currentTime + 0.2;
    for (const n of notes) {
      const when = t0 + n.t;
      const delay = Math.max(0, (when - ctx.currentTime) * 1000);
      this._timers.push(setTimeout(() => {
        if (token !== this._token) return;
        this.app.pressNote(n.m, n.v, 'audition', when);
        this._recHeld.add(n.m);
      }, delay));
      this._timers.push(setTimeout(() => {
        if (token !== this._token) return;
        this.app.releaseNote(n.m, 'audition', when + n.d);
        this._recHeld.delete(n.m);
      }, delay + n.d * 1000));
    }
  }

  // ---------------- 内部 ----------------
  /**
   * 把原始 on/off 配成 { t, d, m, v }（示范曲同格式）。
   * 关键：音频时间轴只算到"最后一个有 off 的音符"，而不是录制停止时刻——
   * 停止录音前那段"发呆等待"的静音不能算进乐曲长度，否则循环会在结尾多出
   * 大段空档、听起来不连贯。仍按着没松的音（无 off）用一个与尾音一致的自然
   * 上限（≤ 有明确结尾的最后一个音符 + TAIL），保证回放里不会无限长。
   */
  _compile() {
    const events = this.events;
    const notes = [];
    const open = new Map();                 // midi -> { t, v }

    let lastOnT = -1;                       // 最后一个 on 的时刻
    let lastClose = 0;                      // 最后一个音符真正结束(off)的时刻
    for (const e of events) {
      if (e.type === 'on') {
        open.set(e.midi, { t: e.t, v: e.v });
        if (e.t > lastOnT) lastOnT = e.t;
      } else {
        const o = open.get(e.midi);
        if (o) {
          notes.push({ t: o.t, d: Math.max(0.05, e.t - o.t), m: e.midi, v: o.v });
          open.delete(e.midi);
        }
        if (e.t > lastClose) lastClose = e.t;
      }
    }

    // 仍有没松开的音：把它自然地补到乐曲末尾（到 lastClose + 尾音为止），
    // 使"录完最后一下立刻停止"时该音与前面连续，不把停顿静音算进长度。
    const onEnd = Math.max(lastOnT, lastClose) + TAIL;
    for (const [midi, o] of open) {
      const d = Math.max(0.05, onEnd - o.t);
      notes.push({ t: o.t, d, m: midi, v: o.v });
    }

    notes.sort((a, b) => a.t - b.t);
    this._compiledEnd = notes.length
      ? Math.max(...notes.map((n) => n.t + n.d))
      : 0;
    return notes;
  }

  /** 乐曲可见总时长（秒）：最后音符的自然收尾 + 尾音；供循环/统计使用 */
  get duration() {
    return (this._compiledEnd ?? 0) + TAIL;
  }

  _emit(state) {
    this.app.ui?.setRecorderState(state);
  }
}
