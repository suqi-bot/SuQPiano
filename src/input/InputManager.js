/**
 * InputManager — 电脑键盘 / 鼠标 / 触摸屏 统一输入层
 *
 * 交互约定：
 *   · 在琴键上按下并拖动 → 滑奏(glissando)，此时不旋转相机
 *   · 在琴身或空白处拖动 → 旋转 / 缩放视角
 *   · 空格 = 延音踏板；← → 或 - = 平移八度；L 开合琴盖；1~5 切换视角
 *   · 支持多点触控（每个 pointerId 独立按下一个音）
 */

import * as THREE from 'three';
import { KEY_TO_OFFSET } from './KeyMap.js';

export class InputManager {
  constructor(app, scene, piano) {
    this.app = app;
    this.sceneMgr = scene;
    this.piano = piano;
    this.canvas = scene.renderer.domElement;

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.pointerNotes = new Map();     // pointerId -> midi
    this.pointerPedals = new Map();    // pointerId -> pedal index
    this.keyboardNotes = new Map();    // code -> midi
    this.baseMidi = 48;                // C3：电脑键盘映射的基准音
    this.hoverMidi = null;
    this.pedalShortcut = null;

    this._bind();
  }

  get octaveBase() { return this.baseMidi; }

  setOctaveBase(m) {
    this.baseMidi = m;
    this.app.onOctaveChanged?.(m);
  }

  _bind() {
    // ---------- 电脑键盘 ----------
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
    window.addEventListener('blur', () => this.app.panic());

    // ---------- 指针（捕获阶段，先于 OrbitControls 判定） ----------
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => this._onPointerDown(e), { capture: true });
    c.addEventListener('pointermove', (e) => this._onPointerMove(e), { capture: true });
    window.addEventListener('pointerup', (e) => this._onPointerUp(e), { capture: true });
    window.addEventListener('pointercancel', (e) => this._onPointerUp(e), { capture: true });
  }

  // ------------------------------------------------------------------
  _onKeyDown(e) {
    const code = e.code;

    // 三踏板快捷键：Space=延音，Shift+Space=持音，Alt+Space=柔音。
    if (code === 'Space') {
      e.preventDefault();
      if (!e.repeat) {
        this.pedalShortcut = e.altKey ? 2 : (e.shiftKey ? 1 : 0);
        this.app.setPedal(this.pedalShortcut, true);
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (code === 'ArrowLeft' || code === 'Minus') { e.preventDefault(); this._shiftOctave(-1); return; }
    if (code === 'ArrowRight' || code === 'Equal') { e.preventDefault(); this._shiftOctave(1); return; }
    if (code === 'KeyL' && !e.repeat) { this.app.toggleLid(); return; }
    if (code === 'Escape') { this.app.panic(); this.app.stopDemo(); return; }
    if (/^Digit[1-5]$/.test(code) && !e.repeat) {
      const views = ['player', 'keys', 'full', 'top', 'side'];
      this.app.setView(views[Number(code.slice(5)) - 1]);
      return;
    }

    const offset = KEY_TO_OFFSET[code];
    if (offset === undefined) return;
    e.preventDefault();
    if (e.repeat) return;                     // 屏蔽系统按键重复

    const midi = this.baseMidi + offset;
    if (this.keyboardNotes.has(code)) return;
    this.keyboardNotes.set(code, midi);
    this.app.pressNote(midi, 0.82, 'kb:' + code);
  }

  _onKeyUp(e) {
    if (e.code === 'Space') {
      const pedal = this.pedalShortcut ?? (e.altKey ? 2 : (e.shiftKey ? 1 : 0));
      this.pedalShortcut = null;
      this.app.setPedal(pedal, false);
      return;
    }
    const midi = this.keyboardNotes.get(e.code);
    if (midi === undefined) return;
    this.keyboardNotes.delete(e.code);
    this.app.releaseNote(midi, 'kb:' + e.code);
  }

  _shiftOctave(dir) {
    const next = this.baseMidi + dir * 12;
    const { startMidi, endMidi } = this.app.range;
    if (next < startMidi || next + 33 > endMidi) return;
    // 已按下的键先松开，避免换八度后卡音
    for (const [code, midi] of [...this.keyboardNotes]) {
      this.app.releaseNote(midi, 'kb:' + code);
    }
    this.keyboardNotes.clear();
    this.setOctaveBase(next);
  }

  // ------------------------------------------------------------------
  _pick(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.sceneMgr.camera);
    const hits = this.raycaster.intersectObjects(this.piano.keyMeshes, false);
    if (!hits.length) return null;
    const midi = hits[0].object.userData.midi;
    const key = this.piano.keys.get(midi);
    if (!key) return null;
    // 触键位置 → 力度：越靠近键前端力度越大
    const ratio = THREE.MathUtils.clamp(
      (hits[0].point.z - key.backZ) / Math.max(0.001, key.frontZ - key.backZ), 0, 1,
    );
    return { midi, velocity: 0.55 + ratio * 0.45 };
  }

  _pickPedal(e) {
    if (!this.piano.pedalMeshes?.length) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.sceneMgr.camera);
    const hits = this.raycaster.intersectObjects(this.piano.pedalMeshes, false);
    return hits.length ? hits[0].object.userData.pedalIndex : null;
  }

  _onPointerDown(e) {
    if (e.button === 2 || e.button === 1) return;      // 右键/中键留给视角操作
    const hit = this._pick(e);
    if (hit) {
      // 命中琴键 → 本次拖拽不旋转相机，改为滑奏
      this.sceneMgr.controls.enabled = false;
      this.canvas.setPointerCapture?.(e.pointerId);
      this.pointerNotes.set(e.pointerId, hit.midi);
      this.app.pressNote(hit.midi, hit.velocity, 'pt:' + e.pointerId);
      return;
    }
    const pedal = this._pickPedal(e);
    if (pedal !== null) {
      this.sceneMgr.controls.enabled = false;
      this.canvas.setPointerCapture?.(e.pointerId);
      this.pointerPedals.set(e.pointerId, pedal);
      this.app.setPedal(pedal, true);
    }
  }

  _onPointerMove(e) {
    const active = this.pointerNotes.get(e.pointerId);
    if (active === undefined) {
      // 悬停时切换光标样式
      const hit = this._pick(e);
      this.canvas.style.cursor = hit ? 'pointer' : 'grab';
      return;
    }
    const hit = this._pick(e);
    if (!hit || hit.midi === active) return;
    this.app.releaseNote(active, 'pt:' + e.pointerId);
    this.pointerNotes.set(e.pointerId, hit.midi);
    this.app.pressNote(hit.midi, hit.velocity * 0.9, 'pt:' + e.pointerId);
  }

  _onPointerUp(e) {
    const pedal = this.pointerPedals.get(e.pointerId);
    if (pedal !== undefined) {
      this.pointerPedals.delete(e.pointerId);
      this.app.setPedal(pedal, false);
    }
    const midi = this.pointerNotes.get(e.pointerId);
    if (midi !== undefined) {
      this.pointerNotes.delete(e.pointerId);
      this.app.releaseNote(midi, 'pt:' + e.pointerId);
    }
    if (this.pointerNotes.size === 0 && this.pointerPedals.size === 0) this.sceneMgr.controls.enabled = true;
  }
}
