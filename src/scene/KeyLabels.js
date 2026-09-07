/**
 * KeyLabels — 琴键贴标（电脑键位 / 音名）
 * 用 Canvas 动态生成纹理，贴在琴键上表面的小平面上；
 * 标签作为琴键 pivot 的子节点，因此按键下沉时会跟着一起动。
 */

import * as THREE from 'three';
import { midiToName } from '../core/NoteUtils.js';
import { labelForOffset } from '../input/KeyMap.js';

const CANVAS_SIZE = 96;
const textureCache = new Map();

function makeTexture(text, color, bg) {
  const cacheKey = `${text}|${color}|${bg}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);

  const c = document.createElement('canvas');
  c.width = c.height = CANVAS_SIZE;
  const g = c.getContext('2d');
  g.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (bg) {
    g.fillStyle = bg;
    roundRect(g, 6, 6, CANVAS_SIZE - 12, CANVAS_SIZE - 12, 16);
    g.fill();
  }
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = text.length > 2 ? 34 : 46;
  const font = (s) => `600 ${s}px "Segoe UI", "PingFang SC", system-ui, sans-serif`;
  g.font = font(size);
  while (g.measureText(text).width > CANVAS_SIZE - 20 && size > 14) {
    size -= 2;
    g.font = font(size);
  }
  g.fillText(text, CANVAS_SIZE / 2, CANVAS_SIZE / 2 + 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(cacheKey, tex);
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export class KeyLabels {
  constructor(keys, parentGroup) {
    this.keys = keys;
    this.parent = parentGroup;
    this.layers = {};              // type -> { objects: [], visible }
    this.current = 'none';
    this.base = undefined;         // 电脑键盘映射的基准 MIDI
  }

  show(type) {
    this.current = type;
    for (const t of Object.keys(this.layers)) this._setVisible(t, t === type);
    if (type === 'none') return;
    if (!this.layers[type]) this.layers[type] = this._build(type);
    this._setVisible(type, true);
  }

  setOctaveBase(base) {
    if (this.base === base) return;
    this.base = base;
    if (this.layers.keyboard) {
      this._destroy('keyboard');
      if (this.current === 'keyboard') this.show('keyboard');
    }
  }

  _setVisible(type, v) {
    const layer = this.layers[type];
    if (!layer) return;
    layer.visible = v;
    for (const o of layer.objects) o.visible = v;
  }

  _destroy(type) {
    const layer = this.layers[type];
    if (!layer) return;
    for (const o of layer.objects) {
      o.parent && o.parent.remove(o);
      o.traverse((n) => {
        if (n.isMesh) { n.geometry.dispose(); n.material.dispose(); }
      });
    }
    delete this.layers[type];
  }

  _build(type) {
    const isNote = type === 'note';
    const objects = [];

    for (const key of this.keys.values()) {
      const text = isNote ? midiToName(key.midi) : this._keyboardLabel(key.midi);
      if (!text) continue;

      const color = key.isBlack ? 'rgba(236,241,255,0.94)' : 'rgba(28,32,42,0.85)';
      const bg = key.isBlack ? 'rgba(255,255,255,0.12)' : null;
      const tex = makeTexture(text, color, bg);

      const size = key.isBlack ? 0.0105 : 0.0158;
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, opacity: 0.95,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      plane.rotation.x = -Math.PI / 2;          // 平铺在键面上
      plane.renderOrder = 3;

      const holder = new THREE.Object3D();
      // 键围绕 balance rail 旋转（pivot 不在键后端），
      // 这里把标签放在"键前缘上方"的世界坐标，转为 pivot 局部坐标
      const labelLocalY = (key.topY - key.pivotY) + 0.0011;
      const frontLocalZ = (key.frontZ - key.pivotZ) - (key.isBlack ? 0.048 : 0.033);
      holder.position.set(0, labelLocalY, frontLocalZ);
      holder.add(plane);
      key.pivot.add(holder);                     // 跟随琴键运动
      objects.push(holder);
    }
    return { objects, visible: true };
  }

  _keyboardLabel(midi) {
    if (this.base === undefined) return null;
    return labelForOffset(midi - this.base);
  }
}
