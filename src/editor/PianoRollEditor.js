/**
 * PianoRollEditor — 音符（Piano Roll）编辑器 渲染 + 交互层
 *
 * 对标 DAW / Piano Roll：
 *   横轴=时间(秒，顶部秒刻度+竖向网格)，纵轴=音高(半音行，白/黑键底纹、左侧音名)
 *   音符=圆角矩形：宽=时长、高=半音、色=白键浅/黑键深、透明度随力度
 *
 * 交互总览（详见随附说明文档）：
 *   单击音符            单选（Ctrl/Shift 增选或减选）
 *   空白拖拽            框选 / 拖选（marquee）
 *   音符上拖拽          移动选中（多选整体平移；音高吸到整半音）
 *   拖音符左 / 右边缘   改起点 / 终点（拉长缩短）
 *   双击空白            新建音符
 *   Delete / Backspace  删除选中
 *   Ctrl+C / Ctrl+V     复制 / 粘贴（粘贴平移到首音后一小段）
 *   Ctrl+Z 等           撤销 / 重做
 *   Esc                 取消选区 / 退出
 *   滚轮                横向缩放时间轴；Shift+滚轮 或滚内容外=缩放；上下键平移音高
 *
 * 数据模型：操作集中在传入的 NoteTimeline（含撤销/重做栈）。
 * 拖动过程以 commit:false 实时改数据但**不写历史**，pointerup 统一把拖动前
 * 快照入历史一次 —— 保证"一次拖拽 = 一条撤销"。
 */
import { midiToName, isBlackKey } from '../core/NoteUtils.js';

const RULER_W = 56;         // 左侧音高刻度栏宽(px)
const TIME_H = 26;          // 顶部时间刻度栏高(px)
const SEMI_H = 20;          // 每半音行高(px)
const MIN_NOTE_PX = 8;      // note 最小可视宽
const MIN_PPS = 18, MAX_PPS = 360;

export class PianoRollEditor {
  /**
   * @param {HTMLElement} root 已含 .pro 骨架的容器
   * @param {NoteTimeline} timeline
   * @param {object} opts { onPlay, onClose, clampMidi }
   */
  constructor(root, timeline, opts = {}) {
    this.root = root;
    this.tl = timeline;
    this.onPlay = opts.onPlay || (() => {});
    this.onClose = opts.onClose || (() => {});
    this.clampMidi = opts.clampMidi || [21, 108];
    this.timeSnap = 0.05;

    this.ppSec = 90;
    this.scrollT = 0;
    this.viewLow = 48; this.viewHigh = 72;
    this.sel = new Set();
    this.clipboard = [];
    this.hover = null;
    this.drag = null;      // {kind}
    this.marquee = null;
    this._raf = 0;
    this._dead = false;

    this._canvas = this.root.querySelector('.pro-canvas');
    this.ctx = this._canvas.getContext('2d');
    this._resize();
    this._fit();
    this._bind();
    this.tl.setListener(() => this._onData());
    this._draw();
  }

  // ---------- DOM / canvas 尺寸 ----------
  _resize() {
    const body = this.root.querySelector('.pro-body');
    this.w = Math.max(300, body.clientWidth);
    this.h = Math.max(200, body.clientHeight);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this._canvas.width = Math.floor(this.w * dpr);
    this._canvas.height = Math.floor(this.h * dpr);
    this._canvas.style.width = this.w + 'px';
    this._canvas.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  destroy() {
    this._dead = true;
    window.removeEventListener('pointermove', this._onPm);
    window.removeEventListener('pointerup', this._onPu);
    document.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    // 只移除本次实例持有的画布与监听，绝不 innerHTML=''——
    // .pro 骨架(工具栏等)是静态的，供关闭后再打开复用。
    if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
    this._canvas = null;
    this.ctx = null;
  }

  // ---------- 事件 ----------
  _bind() {
    const cv = this._canvas;
    this._onPm = (e) => this._pm(e);
    this._onPu = (e) => this._pu(e);
    this._onKey = (e) => this._key(e);
    this._onResize = () => { this._resize(); this._draw(); };
    cv.addEventListener('pointerdown', (e) => this._pd(e));
    window.addEventListener('pointermove', this._onPm);
    window.addEventListener('pointerup', this._onPu);
    document.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);
    cv.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    cv.addEventListener('dblclick', (e) => this._dbl(e));
    // 注意：静态工具栏按钮(data-act)由 NoteEditorController 绑定一次并转发到
    // 当前 editor；这里不再逐次绑定，避免关闭再打开后监听器重复累积。
  }

  // ============ 坐标换算 ============
  midiToY(m) { return TIME_H + (this.viewHigh - m) * SEMI_H; }
  yToMidi(y) { return this.viewHigh - Math.floor((y - TIME_H) / SEMI_H); }
  xToTime(x) { return this.xToT(x - RULER_W); }
  xToT(dx) { return dx / this.ppSec + this.scrollT; }
  tToX(t) { return RULER_W + (t - this.scrollT) * this.ppSec; }
  snapT(t) { return Math.max(0, Math.round(t / this.timeSnap) * this.timeSnap); }
  noteRect(n) {
    const x = this.tToX(n.t);
    const y = this.midiToY(n.m);
    let w = Math.max(MIN_NOTE_PX, n.d * this.ppSec);
    return { x, y, w, h: SEMI_H };
  }
  hit(x, y) {
    const arr = this.tl.getNotes();
    for (let i = arr.length - 1; i >= 0; i--) {
      const n = arr[i], r = this.noteRect(n);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return n;
    }
    return null;
  }
  edgeAt(n, px) {
    const r = this.noteRect(n);
    if (px >= r.x - 4 && px <= r.x + 4) return 'start';
    if (px >= r.x + r.w - 4 && px <= r.x + r.w + 4) return 'end';
    return null;
  }

  // ============ 数据刷新 / 绘制触发 ============
  _onData() {
    // 自动扩展音高范围以容纳新音符
    const arr = this.tl.getNotes();
    if (arr.length) {
      const mn = Math.min(...arr.map((n) => n.m));
      const mx = Math.max(...arr.map((n) => n.m));
      if (mx + 2 > this.viewHigh) this.viewHigh = mx + 2;
      if (mn - 1 < this.viewLow) this.viewLow = this.niceLow(mn);
    }
    this._draw();
  }
  niceLow(m) {
    let low = Math.max(this.clampMidi[0], Math.floor(m / 12) * 12);
    if (low > m) low -= 12;
    return Math.max(this.clampMidi[0], low - 3);
  }

  _request() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; if (!this._dead) this._draw(); });
  }

  // ============ 绘制 ============
  _draw() {
    const { ctx: g, w, h, viewHigh, viewLow } = this;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f7f9fd'; g.fillRect(0, 0, w, h);

    const top = viewHigh, bot = viewLow;
    const rows = top - bot;
    // 内容区行底纹
    for (let m = top; m > bot; m--) {
      const y = this.midiToY(m);
      if (isBlackKey(m)) { g.fillStyle = 'rgba(60,74,110,0.07)'; g.fillRect(RULER_W, y, w - RULER_W, SEMI_H); }
    }
    // 竖向时间网格（每 0.5s 细分线,每 1s 主格线）
    const t0 = Math.floor(this.scrollT / 0.5) * 0.5;
    const t1 = this.scrollT + (w - RULER_W) / this.ppSec;
    for (let t = t0; t <= t1; t += 0.5) {
      const x = this.tToX(t);
      const sec = Math.abs(t - Math.round(t)) < 1e-9;
      g.strokeStyle = sec ? 'rgba(70,86,130,0.22)' : 'rgba(70,86,130,0.08)';
      g.beginPath(); g.moveTo(x, TIME_H); g.lineTo(x, h); g.stroke();
    }

    // 顶部时间刻度
    g.fillStyle = '#e7ebf4'; g.fillRect(RULER_W, 0, w - RULER_W, TIME_H);
    g.fillStyle = '#4a5468'; g.font = '600 11px ui-monospace, monospace'; g.textAlign = 'left';
    for (let t = Math.floor(this.scrollT); t <= t1; t++) {
      const x = this.tToX(t);
      g.fillText(t.toFixed(0) + 's', x + 3, 17);
    }
    // 左侧音高刻度
    g.fillStyle = '#eef1f8'; g.fillRect(0, 0, RULER_W, h);
    for (let m = top; m >= bot; m--) {
      const y = this.midiToY(m);
      const pc = ((m % 12) + 12) % 12;
      g.fillStyle = isBlackKey(m) ? '#8b94a8' : '#4a5468';
      g.font = '600 10px ui-monospace, monospace'; g.textAlign = 'left';
      g.fillText(midiToName(m), 5, y + SEMI_H - 5);
      g.strokeStyle = 'rgba(80,90,120,0.12)';
      g.beginPath(); g.moveTo(0, y + SEMI_H); g.lineTo(RULER_W, y + SEMI_H); g.stroke();
      if (pc === 0) { g.strokeStyle = 'rgba(47,109,246,0.35)'; g.beginPath(); g.moveTo(RULER_W, y); g.lineTo(w, y); g.stroke(); }
    }
    g.strokeStyle = 'rgba(80,90,120,0.3)'; g.beginPath(); g.moveTo(RULER_W, 0); g.lineTo(RULER_W, h); g.stroke();

    // 音符
    const arr = this.tl.getNotes();
    for (const n of arr) {
      const r = this.noteRect(n);
      if (r.x + r.w < RULER_W || r.x > w) continue;
      const isB = isBlackKey(n.m);
      const sel = this.sel.has(n.id);
      const a = 0.35 + 0.62 * Math.min(1, n.v ?? 0.8);
      g.globalAlpha = Math.min(1, a);
      g.fillStyle = isB ? '#3a4152' : '#9db4ff';
      this._rr(r.x, r.y, r.w, SEMI_H, 5); g.fill();
      g.globalAlpha = 1;
      g.lineWidth = sel ? 2.5 : 1;
      g.strokeStyle = sel ? '#ffc53d' : (isB ? '#20242e' : '#5b7ef0');
      this._rr(r.x + (sel ? 1 : 0.5), r.y + (sel ? 1 : 0.5), r.w - (sel ? 2 : 1), SEMI_H - (sel ? 2 : 1), 4); g.stroke();
      if (r.w > 34) {
        g.fillStyle = isB ? '#fff' : '#28304a';
        g.font = '700 10px ui-monospace, monospace';
        g.fillText(midiToName(n.m), r.x + 5, r.y + 14);
      }
    }

    // 框选矩形
    if (this.marquee) {
      const x = Math.min(this.marquee.x0, this.marquee.x1);
      const y = Math.min(this.marquee.y0, this.marquee.y1);
      const ww = Math.abs(this.marquee.x1 - this.marquee.x0);
      const hh = Math.abs(this.marquee.y1 - this.marquee.y0);
      g.fillStyle = 'rgba(47,109,246,0.12)';
      g.strokeStyle = '#2f6df6'; g.lineWidth = 1.5; g.setLineDash([5, 3]);
      g.fillRect(x, y, ww, hh); g.strokeRect(x, y, ww, hh);
      g.setLineDash([]);
    }
    this._syncBar();
  }
  _rr(x, y, w, h, r) {
    const g = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  _syncBar() {
    const total = this.$q('[data-f="total"]');
    const sel = this.$q('[data-f="sel"]');
    if (total) total.textContent = this.tl.length;
    if (sel) sel.textContent = this.sel.size;
    const u = this.$q('[data-act="undo"]'); if (u) u.disabled = !this.tl.canUndo;
    const r2 = this.$q('[data-act="redo"]'); if (r2) r2.disabled = !this.tl.canRedo;
  }
  $q(s) { return this.root.querySelector(s); }

  // ============ 交互：pointerdown ============
  _pt(e) { const r = this._canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  _pd(e) {
    if (e.button === 2) return;
    const p = this._pt(e);
    const n = this.hit(p.x, p.y);
    if (n) {
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      const edge = this.edgeAt(n, p.x);
      if (!add && !this.sel.has(n.id)) this.sel = new Set([n.id]);
      else if (add) {
        if (this.sel.has(n.id)) this.sel.delete(n.id); else this.sel.add(n.id);
      }
      const pre = this._snapshot();
      if (edge && this.sel.has(n.id)) {
        // 记录该音符边缘端的当前绝对时间，作为拉伸参考（多选时按各自原样拉伸同一增量）
        this.drag = { kind: 'resize', mode: edge, pre, refT: this.xToTime(p.x) };
      } else {
        // 移动：固定拖拽起点（指针）与参考时间/音高，做整体位移
        this.drag = { kind: 'move', pre, x0: p.x, y0: p.y, refT: this.xToTime(p.x), refM: this.yToMidi(p.y) };
      }
      this._draw();
      return;
    }
    // 空白 → 框选（不清空可按住 Ctrl 追加）
    const keep = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!keep) this.sel = new Set();
    this.drag = { kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    this._canvas.style.cursor = 'crosshair';
    this._draw();
  }

  _snapshot() { return this.tl.getNotes().map((x) => ({ ...x })); }

  _pm(e) {
    const p = this._pt(e);
    // 悬停高亮与光标
    if (!this.drag) {
      const n = this.hit(p.x, p.y);
      const id = n ? n.id : null;
      if (id !== this.hover) { this.hover = id; this._draw(); }
      this._canvas.style.cursor = n ? (this.edgeAt(n, p.x) ? 'ew-resize' : 'move') : 'default';
      return;
    }
    const d = this.drag;
    if (d.kind === 'marquee') {
      d.x1 = p.x; d.y1 = p.y;
      // 命中判定：与矩形相交
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1);
      const y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      const next = new Set();
      for (const n of this.tl.getNotes()) {
        const r = this.noteRect(n);
        if (r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0) next.add(n.id);
      }
      this.sel = next;
      this._draw();
      return;
    }
    if (d.kind === 'move') {
      // 相对拖拽起点的整体位移
      const dtRaw = this.xToTime(p.x) - d.refT;            // 秒（右拖→时间增大）
      const dmRaw = this.yToMidi(p.y) - d.refM;            // 半音（向上拖 y 减小 → 音高升高，为正）
      const origById = new Map(d.pre.map((o) => [o.id, o]));
      this.tl.apply(() => this.tl.getNotes().map((n) => {
        if (!this.sel.has(n.id)) return n;
        const o = origById.get(n.id) || n;
        const t = this.snapT(o.t + dtRaw);
        const m = Math.round(Math.min(this.clampMidi[1], Math.max(this.clampMidi[0], o.m + dmRaw)));
        return { ...n, t, m };
      }), false);
      this._draw();
      return;
    }
    if (d.kind === 'resize') {
      const dT = this.xToTime(p.x) - d.refT;               // 拉伸增量(秒)
      const origById = new Map(d.pre.map((o) => [o.id, o]));
      this.tl.apply(() => this.tl.getNotes().map((n) => {
        if (!this.sel.has(n.id)) return n;
        const o = origById.get(n.id) || n;
        const end = o.t + o.d;
        if (d.mode === 'start') {
          // 起点随增量移动（终点不变），最小时长下限
          const t = this.snapT(Math.min(end - 0.05, Math.max(0, o.t + dT)));
          return { ...n, t, d: Math.max(0.05, end - t) };
        }
        const e2 = Math.max(o.t + 0.05, this.snapT(end + dT));
        return { ...n, d: Math.max(0.05, e2 - o.t) };
      }), false);
      this._draw();
    }
  }

  _pu(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this._canvas.style.cursor = 'default';
    if ((d.kind === 'move' || d.kind === 'resize') && d.pre) {
      // 与拖动前不同才把"拖动前快照"入历史一次（保证一次拖拽=一条撤销）
      const cur = this._snapshot();
      if (JSON.stringify(cur) !== JSON.stringify(d.pre)) this.tl.commitHistory(d.pre);
    }
    this._draw();
  }

  // ============ 缩放 / 平移 ============
  _wheel(e) {
    e.preventDefault();
    const p = this._pt(e);
    if (e.shiftKey) {
      const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
      const tBefore = this.xToT(p.x - RULER_W);
      this.ppSec = Math.min(MAX_PPS, Math.max(MIN_PPS, this.ppSec * factor));
      this.scrollT = tBefore - (p.x - RULER_W) / this.ppSec;
    } else if (e.altKey) {
      // 垂直缩放音高范围
      const step = e.deltaY > 0 ? 4 : -4;
      this.viewLow += step; this.viewHigh += step;
    } else {
      // 默认纵向滚动时间轴？这里改为横向滚动时间
      const step = e.deltaY > 0 ? 0.25 : -0.25;
      this.scrollT = Math.max(0, this.scrollT + step);
    }
    this._draw();
  }

  _fit() {
    const arr = this.tl.getNotes();
    if (arr.length) {
      const mn = Math.min(...arr.map((n) => n.m)), mx = Math.max(...arr.map((n) => n.m));
      this.viewHigh = mx + 2; this.viewLow = this.niceLow(mn);
      const dur = Math.max(this.tl.duration, 1);
      const cw = Math.max(200, (this.w || 800) - RULER_W);
      this.ppSec = Math.min(MAX_PPS, Math.max(MIN_PPS, cw / dur));
      this.scrollT = 0;
    } else {
      this.viewHigh = 72; this.viewLow = 48; this.ppSec = 90; this.scrollT = 0;
    }
    if (this._draw) this._draw();
  }

  // ============ 双击新建 ============
  _dbl(e) {
    const p = this._pt(e);
    if (p.x < RULER_W || p.y < TIME_H) return;
    const t = this.snapT(this.xToTime(p.x));
    const m = Math.round(this.yToMidi(p.y));
    const id = this.tl.insert(t, m, this.timeSnap, 0.8);
    this.sel = new Set([id]);
  }

  // ============ 动作 / 快捷键 ============
  _act(act) {
    switch (act) {
      case 'play': this.onPlay(this.tl.getNotes()); break;
      case 'undo': this.tl.undo(); break;
      case 'redo': this.tl.redo(); break;
      case 'del': this.deleteSel(); break;
      case 'paste': this.paste(); break;
      case 'zoomIn': this.ppSec = Math.min(MAX_PPS, this.ppSec * 1.3); this._draw(); break;
      case 'zoomOut': this.ppSec = Math.max(MIN_PPS, this.ppSec / 1.3); this._draw(); break;
      case 'fit': this._fit(); break;
      case 'close': this.onClose(); break;
    }
  }
  deleteSel() {
    if (!this.sel.size) return;
    this.tl.remove([...this.sel]);
    this.sel.clear();
  }
  copy() {
    this.clipboard = this.tl.getNotes().filter((n) => this.sel.has(n.id)).map(({ t, d, m, v }) => ({ t, d, m, v }));
  }
  paste() {
    if (!this.clipboard.length) return;
    const base = this.clipboard;
    const minT = Math.min(...base.map((n) => n.t));
    const anchor = this._anchorT();
    let ids = [];
    this.tl.apply((notes) => {
      const added = base.map((n) => ({ id: uid(), t: Math.max(0, anchor + n.t - minT), d: n.d, m: n.m, v: n.v ?? 0.8 }));
      ids = added.map((x) => x.id);
      return [...notes, ...added];
    }, true);
    this.sel = new Set(ids);
  }
  _anchorT() {
    // 有选区则以选区首个音符时间为基准，否则以当前可见起始为准
    const arr = this.tl.getNotes().filter((n) => this.sel.has(n.id));
    return arr.length ? Math.min(...arr.map((n) => n.t)) + 0.2 : this.scrollT + 0.2;
  }
  _key(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); this.tl.undo(); return; }
    if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); this.tl.redo(); return; }
    if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); this.tl.redo(); return; }
    if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); this.copy(); return; }
    if (mod && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); this.paste(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSel(); return; }
    if (e.key === 'Escape') { this.sel.clear(); this._draw(); return; }
    if (e.key === 'ArrowUp') { this.viewHigh += 1; this.viewLow += 1; this._draw(); return; }
    if (e.key === 'ArrowDown') { this.viewHigh -= 1; this.viewLow -= 1; this._draw(); return; }
  }
}

let _uid = (() => { let s = 0x100000; return () => s++; })();
const uid = () => _uid++;
