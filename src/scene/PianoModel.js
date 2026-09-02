/**
 * PianoModel — 三角钢琴（Grand Piano）参数化建模（视觉重建版）
 *
 * 设计目标：一眼就能认出是「三角钢琴」。
 * 与旧版相比的关键修正：
 *   1. 琴弦/铸铁框移到键盘上方（真实钢琴中琴弦高于键面），打开琴盖看到的是「琴弦槽」而非下沉空腔；
 *   2. 琴身边缘(rim)整体加高，轮廓更加修长优雅（纵深 1.62m）；
 *   3. 键盘向前探出琴身，前有低矮的正面踢脚板、两侧颊木，不会被过高的前壁遮挡；
 *   4. 高光漆面材质 + 木质音板 + 金色铭牌 + 红呢条等细节，强化「钢琴」质感。
 *
 * 全部尺寸按真实钢琴物理比例（单位：米）：白键 23.5mm / 黑键 13.7mm / 八度 164.5mm / 键深 10mm / 键面高 ~72cm。
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { computeKeyLayout, midiToFreq } from '../core/NoteUtils.js';

// ============================ 尺寸常量 ============================
const FLOOR_Y = -0.50;         // 地面高度 → 琴腿 50cm，键面距地 72cm
const RIM_H = 0.44;            // 琴身边缘(rim)上沿高度 → 离地 94cm
const RIM_WALL = 0.05;         // 琴身壁厚
const INNER_RIM_TOP = 0.35;    // 内框（音板周圈）上沿
const WHITE_TOP = 0.22;        // 白键上表面（离地 72cm）
const KEY_H = 0.022;           // 白键厚度
const BLACK_RISE = 0.0115;     // 黑键高出白键面
const BLACK_H = 0.034;         // 黑键总高
const KEY_DIP = 0.010;         // 键按下下沉量（垂直下压）
const SB_Y = 0.10;             // 音板上表面
const PLATE_Y = 0.375;         // 铸铁框上表面（高于内框，贴近琴身边缘，内构清晰可见）
const STRING_Y = 0.395;        // 琴弦高度（高于内框上沿，打开琴盖即清晰可见）

// ============================ 几何工具 ============================

/** 上顶面收窄的盒子（用于黑键的梯形截面） */
function taperedBoxGeometry(w, h, l, topScaleX, topScaleZ) {
  const g = new THREE.BoxGeometry(w, h, l);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * topScaleX);
      pos.setZ(i, pos.getZ(i) * topScaleZ);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** 多边形向内/向外等距偏移（带尖角斜接限制） */
function offsetPolygon(pts, d) {
  const n = pts.length;
  const area = pts.reduce((s, p, i) => {
    const q = pts[(i + 1) % n];
    return s + (p.x * q.y - q.x * p.y);
  }, 0);
  const sign = area > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const n1 = edgeNormal(a, p, sign);
    const n2 = edgeNormal(p, b, sign);
    let nx = n1.x + n2.x, ny = n1.y + n2.y;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const dot = Math.max(-1, Math.min(1, n1.x * n2.x + n1.y * n2.y));
    const miter = Math.min(2.2, 1 / Math.max(0.45, Math.sqrt((1 + dot) / 2)));
    out.push(new THREE.Vector2(p.x + nx * d * miter, p.y + ny * d * miter));
  }
  return out;
}

function edgeNormal(a, b, sign) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (dy / len) * sign, y: (-dx / len) * sign };
}

/** 把 (x, depth) 平面的 Shape 挤出成厚度沿 +Y 的板，depth 轴映射到 -Z */
function extrudeUp(shape, thickness, curveSegments = 48) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: false, curveSegments, steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * 三角钢琴翼形轮廓（x: 左右，d: 0=琴身前沿(键盘侧) → D=琴尾）
 * 低音侧（左侧）为近乎直线长边，高音侧（右侧）外鼓后收束到琴尾。
 */
function buildBodyShape(x0, x1, D) {
  const W = x1 - x0;
  const s = new THREE.Shape();
  s.moveTo(x0, 0);                                                        // 前缘左端（低音端）
  s.lineTo(x1, 0);                                                        // 前缘右端（高音端）
  s.bezierCurveTo(x1 + W * 0.02, D * 0.16, x1 + W * 0.15, D * 0.58, x0 + W * 0.90, D * 0.95); // 高音侧外鼓曲线
  s.quadraticCurveTo(x0 + W * 0.62, D * 1.05, x0 + W * 0.36, D * 0.99);  // 琴尾
  s.quadraticCurveTo(x0 + W * 0.02, D * 0.72, x0 + W * 0.008, D * 0.32); // 低音侧长直边
  s.lineTo(x0, 0);
  s.closePath();
  return s;
}

/** 在两点之间放置一根圆柱（用于顶盖支撑杆） */
function orientCylinder(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ============================ 程序化纹理 ============================

/** 云杉木纹（音板） */
function woodGrainTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#dcb87f';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 46; i++) {
    const y = Math.random() * 256;
    g.strokeStyle = `rgba(${140 + Math.random() * 30 | 0},${92 + Math.random() * 20 | 0},42,${0.07 + Math.random() * 0.12})`;
    g.lineWidth = 1 + Math.random() * 2.2;
    g.beginPath();
    g.moveTo(0, y);
    let yy = y;
    for (let x = 0; x <= 256; x += 32) { yy += (Math.random() - 0.5) * 7; g.lineTo(x, yy); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 金色铭牌文字（黄铜底 + 暗刻 GRAND） */
function nameBoardTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const g = c.getContext('2d');
  // 黄铜渐变底
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#dcbd6e');
  grad.addColorStop(0.5, '#c9a24e');
  grad.addColorStop(1, '#b38e3d');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 128);
  // 暗刻边框
  g.strokeStyle = 'rgba(60,40,10,0.55)'; g.lineWidth = 6;
  g.strokeRect(30, 14, 964, 100);
  g.strokeStyle = 'rgba(255,235,180,0.55)'; g.lineWidth = 2;
  g.strokeRect(38, 22, 948, 84);
  // 暗刻文字（带一点高光偏移做出雕刻感）
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 58px Georgia, "Times New Roman", "Songti SC", serif';
  g.fillStyle = 'rgba(52,34,8,0.85)';
  g.fillText('GRAND', 512, 68);
  g.fillStyle = 'rgba(255,240,200,0.35)';
  g.fillText('GRAND', 510, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ============================ 材质 ============================

function createMaterials() {
  const wood = woodGrainTexture();
  return {
    ebony: new THREE.MeshPhysicalMaterial({          // 高光乌木漆面（外壳/顶盖/颊木）
      color: 0x0c0c0e, roughness: 0.07, metalness: 0.05,
      clearcoat: 1, clearcoatRoughness: 0.045, envMapIntensity: 1.55,
    }),
    ebonySat: new THREE.MeshPhysicalMaterial({       // 亚光乌木（底板/内舱）
      color: 0x141416, roughness: 0.55, metalness: 0.0,
      clearcoat: 0.25, clearcoatRoughness: 0.4,
    }),
    innerRim: new THREE.MeshPhysicalMaterial({       // 内框（音板周圈）
      color: 0x1d1d20, roughness: 0.32, metalness: 0.0,
      clearcoat: 0.5, clearcoatRoughness: 0.2,
    }),
    soundboard: new THREE.MeshPhysicalMaterial({     // 云杉音板
      map: wood, color: 0xf5e9cf, roughness: 0.58, metalness: 0.0,
      clearcoat: 0.3, clearcoatRoughness: 0.5, envMapIntensity: 0.9,
    }),
    plate: new THREE.MeshStandardMaterial({          // 铸铁框（亮金，微自发光保证可见）
      color: 0xd8b25c, roughness: 0.34, metalness: 0.75, envMapIntensity: 2.1,
      emissive: 0x4a2c00, emissiveIntensity: 0.38,
    }),
    steel: new THREE.MeshStandardMaterial({          // 钢弦
      color: 0xeee9de, roughness: 0.20, metalness: 1.0, envMapIntensity: 1.9,
      emissive: 0x202020, emissiveIntensity: 0.10,
    }),
    copper: new THREE.MeshStandardMaterial({         // 铜缠弦
      color: 0xc98a48, roughness: 0.30, metalness: 1.0, envMapIntensity: 1.9,
      emissive: 0x2a1600, emissiveIntensity: 0.22,
    }),
    felt: new THREE.MeshStandardMaterial({ color: 0x8c2025, roughness: 0.98, metalness: 0.0 }),
    feltDark: new THREE.MeshStandardMaterial({ color: 0x5a1417, roughness: 1.0, metalness: 0.0 }),
    feltWhite: new THREE.MeshStandardMaterial({ color: 0xf0ede3, roughness: 0.95, metalness: 0.0 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xcfa752, roughness: 0.24, metalness: 1.0 }),
    whiteKey: new THREE.MeshPhysicalMaterial({
      color: 0xf6f3ec, roughness: 0.28, metalness: 0.0,
      clearcoat: 0.55, clearcoatRoughness: 0.12, envMapIntensity: 0.85,
    }),
    blackKey: new THREE.MeshPhysicalMaterial({
      color: 0x101014, roughness: 0.12, metalness: 0.0,
      clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.3,
    }),
    leather: new THREE.MeshPhysicalMaterial({ color: 0x232328, roughness: 0.6, clearcoat: 0.2 }),
  };
}

// ============================ 主构建函数 ============================

export function buildPiano({ startMidi = 28, endMidi = 108 } = {}) {
  const M = createMaterials();
  const root = new THREE.Group();

  const layout = computeKeyLayout(startMidi, endMidi);
  const KW = layout.totalWidth;                 // 键盘宽度 ≈ 1.128m
  const PAD = 0.05;                             // 琴身两侧颊木余量
  const x0 = -PAD, x1 = KW + PAD;
  const DEPTH = Math.max(1.55, KW * 1.42);      // 琴身纵深 ≈ 1.60m（修长）
  const cx = KW / 2;

  // ---------------------------------------------------------------
  // 1. 琴身外壳（环形壳体，前缘在 z=0，键盘向前探出）
  // ---------------------------------------------------------------
  const outerShape = buildBodyShape(x0, x1, DEPTH);
  const outerPts = outerShape.getPoints(72);
  const innerPts = offsetPolygon(outerPts, -RIM_WALL);
  const innerPath = new THREE.Path();
  innerPath.setFromPoints([...innerPts].reverse());
  outerShape.holes.push(innerPath);

  const rim = new THREE.Mesh(extrudeUp(outerShape, RIM_H, 64), M.ebony);
  rim.castShadow = true; rim.receiveShadow = true;
  root.add(rim);

  // 底板（封闭内腔底部）
  const bottomShape = buildBodyShape(x0, x1, DEPTH);
  const bottom = new THREE.Mesh(extrudeUp(bottomShape, 0.02, 48), M.ebonySat);
  bottom.position.y = -0.02;
  bottom.receiveShadow = true;
  root.add(bottom);

  // ---------------------------------------------------------------
  // 2. 内框（音板周圈的抬高边框，特征性的「内框」）+ 音板 + 肋木
  // ---------------------------------------------------------------
  const innerPts2 = offsetPolygon(innerPts, -0.03);
  const innerShape = new THREE.Shape(innerPts);
  const innerShape2 = new THREE.Shape(innerPts2);
  // 内框 = 环形壳体：innerPts 外沿 / innerPts2 内沿
  const innerRingPath = new THREE.Path();
  innerRingPath.setFromPoints([...innerPts2].reverse());
  innerShape.holes.push(innerRingPath);
  const innerRimWall = new THREE.Mesh(extrudeUp(innerShape, INNER_RIM_TOP - SB_Y, 56), M.innerRim);
  innerRimWall.position.y = SB_Y;
  innerRimWall.castShadow = true;
  innerRimWall.receiveShadow = true;
  root.add(innerRimWall);

  // 音板（内框内的实心面板）
  const soundboard = new THREE.Mesh(extrudeUp(innerShape2, 0.008, 48), M.soundboard);
  soundboard.position.y = SB_Y - 0.002;
  soundboard.receiveShadow = true;
  root.add(soundboard);

  // 肋木
  const ribGeo = new THREE.BoxGeometry(1, 0.009, 0.016);
  const ribs = new THREE.InstancedMesh(ribGeo, M.soundboard, 9);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 9; i++) {
    const d = DEPTH * (0.24 + i * 0.075);
    const w = KW * (0.92 - Math.pow(Math.max(0, d / DEPTH - 0.55) / 0.45, 2) * 0.55);
    m4.makeScale(w, 1, 1);
    m4.setPosition(cx, SB_Y - 0.012, -d);
    ribs.setMatrixAt(i, m4);
  }
  ribs.instanceMatrix.needsUpdate = true;
  root.add(ribs);

  // ---------------------------------------------------------------
  // 3. 铸铁框：金色整板铺满内腔（边缘露木音板）+ 纵横梁 + 弦枕
  // ---------------------------------------------------------------
  const plateGroup = new THREE.Group();
  // 金色整板（内框轮廓向内缩 4.5cm，边缘露出木音板）
  const plateOutline = offsetPolygon(innerPts2, -0.045);
  const plateShape = new THREE.Shape(plateOutline);
  const platePanel = new THREE.Mesh(extrudeUp(plateShape, 0.022, 56), M.plate);
  platePanel.position.y = PLATE_Y - 0.011;
  platePanel.castShadow = true;
  plateGroup.add(platePanel);

  // 纵向梁（跨过板面，五条斜向支撑）
  const frontZ = -0.10, backZ = -DEPTH * 0.93;
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const sx = lerp(x0 + 0.10, x1 - 0.10, t);
    const ex = lerp(x0 + 0.18, x1 - 0.30, t);
    const len = Math.abs(backZ - frontZ);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.020, len), M.plate);
    const midX = (sx + ex) / 2, midZ = (frontZ + backZ) / 2;
    bar.position.set(midX, PLATE_Y + 0.008, midZ);
    bar.rotation.y = Math.atan2(ex - sx, backZ - frontZ);
    bar.castShadow = true;
    plateGroup.add(bar);
  }
  // 横向梁
  for (const [z, w] of [[-0.26, KW * 0.94], [-DEPTH * 0.62, KW * 0.78], [-DEPTH * 0.90, KW * 0.46]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.018, 0.026), M.plate);
    bar.position.set(cx, PLATE_Y + 0.008, z);
    bar.castShadow = true;
    plateGroup.add(bar);
  }
  // 弦枕（前）与挂弦钉板（后）
  const agraffe = new THREE.Mesh(new THREE.BoxGeometry(KW * 0.94, 0.028, 0.03), M.plate);
  agraffe.position.set(cx, PLATE_Y + 0.014, -0.11);
  agraffe.castShadow = true;
  plateGroup.add(agraffe);
  // 挂弦钉板（低音侧直边附近）
  const hitch = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.026, DEPTH * 0.7), M.plate);
  hitch.position.set(x0 + 0.11, PLATE_Y + 0.010, -DEPTH * 0.42);
  hitch.rotation.y = 0.03;
  plateGroup.add(hitch);
  root.add(plateGroup);

  // 内腔补光：照亮琴弦/铸铁框/音板，避免内腔发黑
  const interiorLight = new THREE.PointLight(0xffe8c8, 20, 3.6, 1.7);
  interiorLight.position.set(cx, 0.42, -DEPTH * 0.5);
  root.add(interiorLight);

  // ---------------------------------------------------------------
  // 4. 琴弦（低音铜缠弦 / 高音钢弦，含同音弦组）—— 位于键盘上方
  // ---------------------------------------------------------------
  const stringDefs = [];
  for (const k of layout.keys) {
    const f = midiToFreq(k.midi);
    const t = (k.midi - startMidi) / Math.max(1, endMidi - startMidi);
    const copper = k.midi < 52;
    const count = k.midi < 36 ? 2 : (k.midi < 60 ? 2 : 3);
    const len = Math.min(DEPTH * 0.90, Math.max(0.30, 1.22 * Math.pow(440 / f, 0.42)));
    const radius = Math.max(0.0016, Math.min(0.0048, 0.0048 * Math.pow(440 / f, 0.33)));
    for (let u = 0; u < count; u++) {
      const off = (u - (count - 1) / 2) * 0.0055;
      stringDefs.push({
        copper, radius,
        x1: 0.055 + t * (KW - 0.11) + off,
        z1: -0.07,
        x2: 0.055 + t * (KW - 0.11) + off + (1 - t) * 0.07,
        z2: -0.07 - len,
      });
    }
  }
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const copperCount = stringDefs.filter((s) => s.copper).length;
  const steelCount = stringDefs.length - copperCount;
  const copperMesh = new THREE.InstancedMesh(cylGeo, M.copper, copperCount);
  const steelMesh = new THREE.InstancedMesh(cylGeo, M.steel, steelCount);
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), dir = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let ci = 0, si = 0;
  for (const s of stringDefs) {
    pa.set(s.x1, STRING_Y, s.z1);
    pb.set(s.x2, STRING_Y, s.z2);
    dir.subVectors(pb, pa);
    const len = dir.length();
    q.setFromUnitVectors(up, dir.clone().normalize());
    sc.set(s.radius, len, s.radius);
    m4.compose(pa.clone().addScaledVector(dir, 0.5), q, sc);
    if (s.copper) copperMesh.setMatrixAt(ci++, m4);
    else steelMesh.setMatrixAt(si++, m4);
  }
  copperMesh.instanceMatrix.needsUpdate = true;
  steelMesh.instanceMatrix.needsUpdate = true;
  root.add(copperMesh, steelMesh);

  // ---------------------------------------------------------------
  // 5. 制音器（随按键抬起，可动）
  // ---------------------------------------------------------------
  const DAMPER_Y = STRING_Y + 0.012;
  const damperDefs = [];
  for (const k of layout.keys) {
    const t = (k.midi - startMidi) / Math.max(1, endMidi - startMidi);
    damperDefs.push({
      midi: k.midi,
      x: 0.055 + t * (KW - 0.11),
      z: -0.13 - t * DEPTH * 0.10,
      lifted: false,
    });
  }
  const damperGeo = new THREE.BoxGeometry(0.011, 0.022, 0.032);
  const dampers = new THREE.InstancedMesh(damperGeo, M.feltDark, damperDefs.length);
  const damperIndex = new Map();
  damperDefs.forEach((d, i) => {
    damperIndex.set(d.midi, i);
    m4.makeTranslation(d.x, DAMPER_Y, d.z);
    dampers.setMatrixAt(i, m4);
  });
  dampers.instanceMatrix.needsUpdate = true;
  dampers.castShadow = true;
  root.add(dampers);

  // ---------------------------------------------------------------
  // 6. 击弦机舱 + 键盘区域 + 前板 + 颊木 + 挡板 + 铭牌 + 谱架
  // ---------------------------------------------------------------
  // 击弦机舱（填满琴弦与键盘之间的空间）
  const actionBay = new THREE.Mesh(new THREE.BoxGeometry(KW * 0.96, 0.10, 0.20), M.ebonySat);
  actionBay.position.set(cx, 0.25, -0.16);
  actionBay.castShadow = true;
  root.add(actionBay);

  // 键盘托（键下木托）
  const keyBed = new THREE.Mesh(new THREE.BoxGeometry(KW + PAD * 2, 0.03, 0.22), M.ebonySat);
  keyBed.position.set(cx, 0.183, 0.075);
  keyBed.receiveShadow = true; keyBed.castShadow = true;
  root.add(keyBed);

  // 正面踢脚板（键盘下方的低矮前板，让琴键露出来）
  const keySlip = new THREE.Mesh(new THREE.BoxGeometry(KW + PAD * 2, 0.13, 0.02), M.ebony);
  keySlip.position.set(cx, 0.125, 0.16);
  keySlip.castShadow = true;
  root.add(keySlip);

  // 键前红呢条（前档呢）
  const feltStrip = new THREE.Mesh(new THREE.BoxGeometry(KW, 0.006, 0.008), M.felt);
  feltStrip.position.set(cx, 0.195, 0.15);
  root.add(feltStrip);

  // 颊木（键盘两侧）
  for (const sx of [x0 + PAD / 2, x1 - PAD / 2]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(PAD, 0.18, 0.16), M.ebony);
    cheek.position.set(sx, 0.26, 0.06);
    cheek.castShadow = true;
    root.add(cheek);
  }

  // 键后挡板（fallboard，降矮让内构从演奏位可见）
  const fallboard = new THREE.Mesh(new THREE.BoxGeometry(KW, 0.14, 0.02), M.ebony);
  fallboard.position.set(cx, 0.26, -0.02);
  fallboard.castShadow = true;
  root.add(fallboard);

  // 击弦机槌头（白呢，位于琴弦前方/挡板之后，倾斜指向琴弦）
  const hammerRail = new THREE.Mesh(new THREE.BoxGeometry(KW * 0.92, 0.016, 0.02), M.ebonySat);
  hammerRail.position.set(cx, 0.315, -0.085);
  root.add(hammerRail);
  const hammerGeo = new THREE.BoxGeometry(0.007, 0.017, 0.021);
  const hammerQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.75);
  const hammerScale = new THREE.Vector3(1, 1, 1);
  const hammerP = new THREE.Vector3();
  const hammers = new THREE.InstancedMesh(hammerGeo, M.feltWhite, layout.keys.length);
  for (let i = 0; i < layout.keys.length; i++) {
    const kk = layout.keys[i];
    hammerP.set(kk.centerX, 0.328, kk.isBlack ? -0.072 : -0.080);
    m4.compose(hammerP, hammerQuat, hammerScale);
    hammers.setMatrixAt(i, m4);
  }
  hammers.instanceMatrix.needsUpdate = true;
  root.add(hammers);

  // 金色铭牌（贴在挡板正前方，面向演奏者）
  const nameTex = nameBoardTexture();
  const namePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(KW * 0.72, 0.09),
    new THREE.MeshBasicMaterial({ map: nameTex }),
  );
  namePlane.position.set(cx, 0.265, -0.004);
  root.add(namePlane);

  // 谱架
  const desk = new THREE.Group();
  const deskPanel = new THREE.Mesh(new THREE.BoxGeometry(KW * 0.80, 0.16, 0.014), M.ebony);
  deskPanel.position.set(0, 0.09, 0);
  deskPanel.castShadow = true;
  const deskLip = new THREE.Mesh(new THREE.BoxGeometry(KW * 0.80, 0.016, 0.028), M.ebony);
  deskLip.position.set(0, 0.006, 0.016);
  desk.add(deskPanel, deskLip);
  desk.position.set(cx, 0.37, -0.10);
  desk.rotation.x = 0.28;
  root.add(desk);

  // ---------------------------------------------------------------
  // 7. 琴键（81 键，可按下；键盘向前探出琴身）
  // ---------------------------------------------------------------
  const keys = new Map();
  const keyMeshes = [];
  const wSample = layout.keys.find((k) => !k.isBlack);
  const bSample = layout.keys.find((k) => k.isBlack);
  const whiteGeo = new RoundedBoxGeometry(wSample.width, KEY_H, wSample.length, 2, 0.0015);
  const blackGeo = taperedBoxGeometry(bSample.width, BLACK_H, bSample.length, 9.8 / 13.7, 0.90);

  for (const k of layout.keys) {
    const isBlack = k.isBlack;
    const backZ = isBlack ? 0.002 : 0;
    const len = k.length;

    const pivot = new THREE.Group();
    pivot.position.set(k.centerX, 0, backZ);

    const mat = (isBlack ? M.blackKey : M.whiteKey).clone();
    mat.emissive = new THREE.Color(0x000000);

    const mesh = new THREE.Mesh(isBlack ? blackGeo : whiteGeo, mat);
    const topY = isBlack ? WHITE_TOP + BLACK_RISE : WHITE_TOP;
    mesh.position.set(0, topY - (isBlack ? BLACK_H / 2 : KEY_H / 2), len / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.midi = k.midi;
    pivot.add(mesh);
    root.add(pivot);

    const keyObj = {
      midi: k.midi, isBlack, pivot, mesh, material: mat,
      length: len, backZ, frontZ: backZ + len, centerX: k.centerX, topY,
      press: 0, target: 0,
      maxAngle: Math.asin(KEY_DIP / len),
    };
    keys.set(k.midi, keyObj);
    keyMeshes.push(mesh);
  }

  // ---------------------------------------------------------------
  // 8. 顶盖（可开合）+ 支撑杆
  // ---------------------------------------------------------------
  const lidShape = buildBodyShape(x0 - 0.006, x1 + 0.006, DEPTH + 0.006);
  const lidGeo = extrudeUp(lidShape, 0.026, 56);
  const LID_HINGE_X = x0 + 0.02;
  const lidPivot = new THREE.Group();
  lidPivot.position.set(LID_HINGE_X, RIM_H + 0.012, 0);
  const lidMesh = new THREE.Mesh(lidGeo, M.ebony);
  lidMesh.position.x = -LID_HINGE_X;
  lidMesh.castShadow = true;
  lidMesh.receiveShadow = true;
  lidPivot.add(lidMesh);
  root.add(lidPivot);

  const propGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 10);
  const prop = new THREE.Mesh(propGeo, M.brass);
  prop.castShadow = true;
  root.add(prop);

  const LID_MAX = 1.35;   // 琴盖最大开度（≈77°，近乎竖直，不遮挡内腔）
  let lidProgress = 1;
  const propBase = new THREE.Vector3(KW * 0.80, RIM_H + 0.002, -DEPTH * 0.30);
  const propLocal = new THREE.Vector3(KW * 0.80 - LID_HINGE_X, 0, -DEPTH * 0.30);

  function updateLid(p) {
    lidProgress = p;
    const angle = LID_MAX * p;
    lidPivot.rotation.z = angle;
    prop.visible = p > 0.05;
    if (prop.visible) {
      const top = propLocal.clone();
      top.applyAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      top.add(lidPivot.position);
      orientCylinder(prop, propBase, top);
    }
  }
  updateLid(1);

  // ---------------------------------------------------------------
  // 9. 琴腿 / 脚轮 / 踏板架 / 琴凳
  // ---------------------------------------------------------------
  const legH = -FLOOR_Y;
  const legPositions = [
    [x0 + 0.08, 0.02], [x1 - 0.08, 0.02], [KW * 0.30, -DEPTH * 0.84],
  ];
  for (const [lx, lz] of legPositions) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.052, legH, 20), M.ebony);
    leg.position.set(lx, FLOOR_Y + legH / 2, lz);
    leg.castShadow = true;
    root.add(leg);
    const caster = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.030, 0.024, 16), M.brass);
    caster.position.set(lx, FLOOR_Y + 0.012, lz);
    root.add(caster);
  }

  // 踏板架（lyre）：立柱 + 底座 + 三块踏板（位于琴身正面、键盘下方可见处）
  const lyreX = cx - 0.02, lyreZ = 0.10;
  const postTop = -0.06, postBottom = FLOOR_Y + 0.03;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.042, postTop - postBottom, 0.042), M.ebony);
  post.position.set(lyreX, (postTop + postBottom) / 2, lyreZ);
  post.castShadow = true;
  root.add(post);
  const lyreBase = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.03, 0.17), M.ebony);
  lyreBase.position.set(lyreX, FLOOR_Y + 0.015, lyreZ - 0.02);
  lyreBase.castShadow = true;
  root.add(lyreBase);

  const pedals = [];
  [-0.078, 0, 0.078].forEach((dx, i) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.082), M.brass);
    p.position.set(lyreX + dx, FLOOR_Y + 0.052, lyreZ + 0.03);
    p.castShadow = true;
    root.add(p);
    pedals.push({ mesh: p, baseY: p.position.y, press: 0, target: 0 });
  });

  // 琴凳
  const bench = new THREE.Group();
  const seatY = 0.50;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.35), M.leather);
  seat.position.y = seatY - 0.03;
  seat.castShadow = true; seat.receiveShadow = true;
  bench.add(seat);
  const benchLegLen = seatY - 0.06;
  for (const [sx, sz] of [[-0.24, -0.125], [0.24, -0.125], [-0.24, 0.125], [0.24, 0.125]]) {
    const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, benchLegLen, 12), M.ebony);
    lg.position.set(sx, benchLegLen / 2, sz);
    lg.castShadow = true;
    bench.add(lg);
  }
  bench.position.set(cx, FLOOR_Y, 0.66);
  bench.name = 'bench';
  root.add(bench);

  // ---------------------------------------------------------------
  //  对外接口
  // ---------------------------------------------------------------
  const bounds = {
    centerX: cx, width: KW, depth: DEPTH,
    topY: RIM_H, keyTopY: WHITE_TOP, floorY: FLOOR_Y,
  };

  function setDamper(midi, lifted) {
    const i = damperIndex.get(midi);
    if (i === undefined) return;
    const d = damperDefs[i];
    if (d.lifted === lifted) return;
    d.lifted = lifted;
    m4.makeTranslation(d.x, DAMPER_Y + (lifted ? 0.017 : 0), d.z);
    dampers.setMatrixAt(i, m4);
    dampers.instanceMatrix.needsUpdate = true;
  }

  function setPedal(index, down) {
    if (pedals[index]) pedals[index].target = down ? 1 : 0;
  }

  function update(dt) {
    const kf = 1 - Math.exp(-dt * 34);
    for (const k of keys.values()) {
      const diff = k.target - k.press;
      if (Math.abs(diff) < 0.0005 && k.press === k.target) continue;
      k.press += diff * kf;
      k.pivot.position.y = -k.press * KEY_DIP;   // 垂直下压，不产生旋转形变
      const glow = k.press * (k.isBlack ? 0.5 : 0.34);
      k.material.emissive.setRGB(glow * 0.30, glow * 0.52, glow * 0.95);
    }
    for (const p of pedals) {
      const diff = p.target - p.press;
      if (Math.abs(diff) > 0.001) {
        p.press += diff * (1 - Math.exp(-dt * 26));
        p.mesh.position.y = p.baseY - p.press * 0.010;
        p.mesh.rotation.x = p.press * 0.16;      // 前缘向下倾斜（正确踩踏方向）
      }
    }
  }

  return {
    group: root, keys, keyMeshes, bounds, layout, materials: M,
    setDamper, setPedal, updateLid, update,
    get lidProgress() { return lidProgress; },
  };
}
