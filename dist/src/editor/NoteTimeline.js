/**
 * NoteTimeline — 可编辑的音符编曲文档模型（Piano Roll 数据层）
 *
 * 职责：
 *   - 把一段录音编译成一份"可编辑音符列表"，每个音符 { id, t, d, m, v }：
 *       t 起始秒、d 时长秒、m MIDI 音高、v 力度(0~1)
 *   - 是编辑器的唯一数据源；提供 translate / resize / remove / insert 等原语
 *   - 内置基于"整文档快照"的 撤销/重做 栈（命令粒度为一次完整的编辑操作）
 *   - 对外保留与 Recorder 相同的 { t, d, m, v } 结构（额外带稳定 id），
 *     因此导出的结果可被 Recorder.play()/循环 直接消费，不破坏既有回放链路。
 *
 * 时间单位统一为"秒"；本模型不感知坐标系，坐标换算由渲染层负责。
 */

let __seq = 1; // 全局自增 id，保证编辑器会话内 id 唯一

export class NoteTimeline {
  /**
   * @param {Array<{t:number,d:number,m:number,v?:number}>} notes 初始（来自录音编译结果）
   */
  constructor(notes = []) {
    /** 当前音符（唯一事实源）。元素只读、修改一律走原语以触发历史记录 */
    this.notes = notes.map((n) => ({ id: __seq++, t: n.t, d: n.d, m: n.m, v: n.v ?? 0.8 }));
    this.undoStack = [];   // 历史快照（旧 notes 数组）
    this.redoStack = [];
    this._maxHistory = 100;
    this._listeners = new Set();
    this._onChange = null; // { onChange } 回调
  }

  // ---------------- 事件 ----------------
  setListener(fn) { this._onChange = fn; }
  onChange() {
    this._sort();
    this._onChange?.();
    for (const l of this._listeners) l(this.notes);
  }

  // ---------------- 只读查询 ----------------
  getNotes() { return this.notes; }
  get length() { return this.notes.length; }
  /** 乐曲可见总时长（秒）：末音结束点 + 0.25s 收尾，至少 1s，用于标尺宽度 */
  get duration() {
    const end = this.notes.reduce((a, n) => Math.max(a, n.t + n.d), 0);
    return Math.max(1, end + 0.25);
  }
  get minMidi() { return this.notes.length ? Math.min(...this.notes.map((n) => n.m)) : 48; }
  get maxMidi() { return this.notes.length ? Math.max(...this.notes.map((n) => n.m)) : 60; }

  // ---------------- 快照 / 历史 ----------------
  _snapshot() { return this.notes; }

  _pushHistory() {
    // 记录当前数组的深拷贝作为历史（旧状态）
    const snap = this.notes.map((n) => ({ ...n }));
    this.undoStack.push(snap);
    if (this.undoStack.length > this._maxHistory) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.notes.map((n) => ({ ...n })));
    this.notes = this.undoStack.pop();
    this.onChange();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.notes.map((n) => ({ ...n })));
    this.notes = this.redoStack.pop();
    this.onChange();
    return true;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /**
   * 应用一次"批量改动"。
   * commit 为 true：改动前自动把当前态压入撤销栈（可撤销的正式编辑）。
   * commit 为 false：仅改数据、不写历史，用于拖动过程中的实时预览；
   *   结束后由调用方 `commitHistory(拖动前快照)` 统一入栈一次。
   * @param {Function} mutate (notes:Array) => Array 返回新数组
   * @param {boolean} commit
   */
  apply(mutate, commit = true) {
    if (commit) this._pushHistory();
    this.notes = mutate(this.notes);
    this.onChange();
  }

  /**
   * 把给定的"拖动前快照"压入撤销栈一次（用于 commit:false 的连续预览操作收尾）。
   * @param {Array<{id,t,d,m,v}>} preSnapshot 改动前状态
   */
  commitHistory(preSnapshot) {
    if (!Array.isArray(preSnapshot)) return;
    const snap = preSnapshot.map((n) => ({ ...n }));
    this.undoStack.push(snap);
    if (this.undoStack.length > this._maxHistory) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
  }

  /** 重置整份（录制新一遍时调用） */
  replaceAll(notes) {
    this._pushHistory();
    this.notes = notes.map((n) => ({ id: __seq++, t: n.t, d: n.d, m: n.m, v: n.v ?? 0.8 }));
    this.onChange();
  }

  /** 清空 */
  clearAll() {
    if (!this.notes.length) return;
    this._pushHistory();
    this.notes = [];
    this.onChange();
  }

  _sort() {
    this.notes.sort((a, b) => (a.t - b.t) || (a.m - b.m));
  }

  // ================= 便捷编辑原语（供渲染层复用） =================

  /** 删除指定 id 的音符 */
  remove(ids) {
    const set = new Set(ids);
    this.apply((notes) => notes.filter((n) => !set.has(n.id)), true);
  }

  /** 在 (t, m) 新增一个默认音，返回其 id */
  insert(t, m, d = 0.25, v = 0.8) {
    let id = 0;
    this.apply((notes) => {
      const nn = { id: __seq++, t, d, m, v };
      id = nn.id;
      return [...notes, nn];
    }, true);
    return id;
  }

  /**
   * 平移若干音符（时间与音高）。deltaT 秒、deltaMidi 半音。
   * commit=false 用于拖动过程中实时预览，结束由调用方 commit 一次。
   */
  translate(ids, deltaT, deltaMidi, { commit = true, clampMidi = [21, 108] } = {}) {
    const set = new Set(ids);
    this.apply((notes) => notes.map((n) => {
      if (!set.has(n.id)) return n;
      const m = Math.round(Math.min(clampMidi[1], Math.max(clampMidi[0], n.m + deltaMidi)));
      const t = Math.max(0, n.t + deltaT);
      return { ...n, m, t };
    }), commit);
  }

  /**
   * 调整时长：ids 命中的音符，把新起点或新终点应用到它们。
   * mode: 'start'|'end'；newTime 为该端的新绝对时间(秒)。
   */
  resize(ids, mode, newTime, { commit = true } = {}) {
    const set = new Set(ids);
    const MIN_D = 0.05;
    this.apply((notes) => notes.map((n) => {
      if (!set.has(n.id)) return n;
      if (mode === 'start') {
        const end = n.t + n.d;
        const t = Math.max(0, Math.min(end - MIN_D, newTime));
        return { ...n, t, d: Math.max(MIN_D, end - t) };
      }
      // mode==='end'：整体向右拉长（不改变起始）
      const end = Math.max(n.t + MIN_D, newTime);
      return { ...n, d: Math.max(MIN_D, end - n.t) };
    }), commit);
  }
}
