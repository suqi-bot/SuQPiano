/**
 * 离线自检脚本（不依赖浏览器）：
 *   1. 校验 81 键排布的数量、坐标、尺寸是否符合真实钢琴规格
 *   2. 真正构建一遍三角钢琴三维模型（几何计算），捕捉 three.js API 误用
 *   3. 校验示范曲事件流的合法性
 * 运行： node tools/selfcheck.mjs
 */

import * as THREE from 'three';
import { computeKeyLayout, midiToName, midiToFreq, isBlackKey } from '../src/core/NoteUtils.js';
import { buildPiano } from '../src/scene/PianoModel.js';
import { DEMO_SONGS } from '../src/app/DemoSongs.js';
import { KEY_TO_OFFSET, OFFSET_LABELS } from '../src/input/KeyMap.js';

let failed = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}${extra ? '  ' + extra : ''}`);
  else { console.log(`  ✗ ${msg}  ${extra}`); failed++; }
};

console.log('\n[1] 键位排布');
const layout = computeKeyLayout(28, 108);
ok(layout.keys.length === 81, '总键数 = 81', `实际 ${layout.keys.length}`);
const whites = layout.keys.filter((k) => !k.isBlack);
const blacks = layout.keys.filter((k) => k.isBlack);
ok(whites.length === 48 && blacks.length === 33, '白键 48 / 黑键 33', `${whites.length}/${blacks.length}`);
ok(Math.abs(layout.totalWidth - 48 * 0.0235) < 1e-9, '键盘宽度 = 48 × 23.5mm', (layout.totalWidth * 1000).toFixed(1) + 'mm');

// 八度跨度
const c3 = whites.find((k) => k.midi === 48);
const c4 = whites.find((k) => k.midi === 60);
ok(Math.abs((c4.centerX - c3.centerX) - 0.1645) < 1e-6, '八度跨度 = 164.5mm',
  ((c4.centerX - c3.centerX) * 1000).toFixed(1) + 'mm');

// 黑键必须跨越白键交界、且左右都有重叠
let straddleErr = 0;
for (const b of blacks) {
  const lower = whites.find((k) => k.midi === b.midi - 1);
  const upper = whites.find((k) => k.midi === b.midi + 1);
  if (!lower || !upper) { straddleErr++; continue; }
  const l = b.centerX - b.width / 2, r = b.centerX + b.width / 2;
  const boundary = (lower.centerX + upper.centerX) / 2;
  if (!(l < boundary && r > boundary)) straddleErr++;   // 必须跨越交界
}
ok(straddleErr === 0, '全部黑键跨越白键交界（与真琴一致）', `异常 ${straddleErr} 个`);

// 键面不重叠（同层内）
let overlap = 0;
for (let i = 1; i < whites.length; i++) if (whites[i].centerX <= whites[i - 1].centerX) overlap++;
for (let i = 1; i < blacks.length; i++) if (blacks[i].centerX <= blacks[i - 1].centerX) overlap++;
ok(overlap === 0, '白/黑键均严格递增、无重叠');

console.log('\n[2] 音高');
ok(Math.abs(midiToFreq(69) - 440) < 1e-9, 'A4 = 440Hz');
ok(midiToName(28) === 'E1' && midiToName(108) === 'C8', '音域 E1 ~ C8', `${midiToName(28)}~${midiToName(108)}`);
ok(isBlackKey(29) === false && isBlackKey(30) === true, 'F1 白键 / F#1 黑键');

console.log('\n[3] 电脑键盘映射');
ok(Object.keys(KEY_TO_OFFSET).length >= 34, '映射键位数', String(Object.keys(KEY_TO_OFFSET).length));
const offs = Object.values(KEY_TO_OFFSET);
ok(Math.max(...offs) === 33 && Math.min(...offs) === 0, '覆盖 0~33 半音（符号键 [ ] \\ 落在白键 F5/G5/A5）');
ok(OFFSET_LABELS.length === 34, '标签表长度 = 34', String(OFFSET_LABELS.length));

console.log('\n[4] 三维建模（真实构建一次）');
const piano = buildPiano({ startMidi: 28, endMidi: 108 });
ok(piano.keys.size === 81, '琴键对象数 = 81', String(piano.keys.size));
ok(piano.keyMeshes.length === 81, '可拾取 mesh 数 = 81');

let meshes = 0, tris = 0, nan = 0;
piano.group.traverse((o) => {
  if (!o.isMesh && !o.isInstancedMesh) return;
  meshes++;
  const g = o.geometry;
  const count = g.index ? g.index.count : g.attributes.position.count;
  tris += (count / 3) * (o.isInstancedMesh ? o.count : 1);
  const pos = g.attributes.position.array;
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) { nan++; break; }
});
ok(nan === 0, '所有几何体顶点均为有限值（无 NaN）', `异常 ${nan} 个`);
ok(meshes > 0 && tris > 0, '网格/三角面统计', `${meshes} 个 mesh，约 ${Math.round(tris / 1000)}k 三角面`);

// 包围盒合理性检验：应接近真实三角钢琴尺寸（不含琴凳）
piano.group.updateMatrixWorld(true);
const box = new THREE.Box3();
piano.group.traverse((o) => {
  if (!o.isMesh && !o.isInstancedMesh) return;
  let p = o, isBench = false;
  while (p) { if (p.name === 'bench') { isBench = true; break; } p = p.parent; }
  if (!isBench) box.union(new THREE.Box3().setFromObject(o));
});
const size = box.getSize(new THREE.Vector3());
ok(size.x > 1.1 && size.x < 1.35, '琴身宽度 1.1~1.35m', size.x.toFixed(3) + 'm');
ok(size.z > 1.2 && size.z < 1.7, '琴身纵深 1.2~1.7m（不含琴凳）', size.z.toFixed(3) + 'm');
ok(size.y > 1.2 && size.y < 1.8, '整体高度(顶盖开启)合理', size.y.toFixed(3) + 'm');
ok(Math.abs((piano.bounds.keyTopY - piano.bounds.floorY) - 0.72) < 1e-9,
  '键面距地 = 72cm（人体工学）', ((piano.bounds.keyTopY - piano.bounds.floorY) * 100).toFixed(1) + 'cm');
ok(piano.bounds.keyTopY < piano.bounds.topY, '键面低于琴身上沿（可见内腔）',
  `键面 ${piano.bounds.keyTopY} / 上沿 ${piano.bounds.topY}`);

// 内腔分层几何：环/开孔一旦退化成实心板，从上方看就只剩一块平板（“内构不显示”的根因）。
console.log('\n[4b] 内腔分层几何（环与开孔不得退化成实心板）');
const ol = piano.outlines;
// 射线法内点测试：与 PianoModel 里的同名函数独立实现，做交叉验证。
function inPoly(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i].y > z) !== (pts[j].y > z)
      && x < (pts[j].x - pts[i].x) * (z - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
}
function polyArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return Math.abs(s / 2);
}
const nested = (a, b) => a.every((p) => inPoly(b, p.x, p.y));
ok(nested(ol.inner, ol.outer), '内壁严格在外轮廓之内（rim 壁环成立）');
ok(nested(ol.lipInner, ol.inner), '压边内孔严格在内壁之内');
ok(nested(ol.soundboardPts, ol.inner), '音板轮廓严格在内壁之内');
ok(nested(ol.platePts, ol.soundboardPts), '铁板轮廓严格在音板之内');
ok(nested(ol.plateFramePts, ol.platePts), '铁板压条内孔严格在铁板之内');
ok(ol.plateHoles.length >= 5 && ol.plateHoles.every((h) => h.every((p) => inPoly(ol.platePts, p.x, p.y))),
  '铁板开窗全部落在铁板内', `${ol.plateHoles.length} 个开口`);

// 从挤出几何里取顶面（三个顶点同高）三角形面积和，用来发现“丢孔退化成实心板”。
function topCapArea(name) {
  const mesh = piano.group.getObjectByName(name);
  if (!mesh) return NaN;
  const pos = mesh.geometry.attributes.position;
  let yMax = -Infinity, area = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const y0 = pos.getY(i), y1 = pos.getY(i + 1), y2 = pos.getY(i + 2);
    if (Math.abs(y0 - y1) > 1e-9 || Math.abs(y1 - y2) > 1e-9) continue;   // 侧壁
    if (y0 > yMax + 1e-9) { yMax = y0; area = 0; }
    if (Math.abs(y0 - yMax) > 1e-9) continue;
    const ax = pos.getX(i), az = pos.getZ(i);
    const bx = pos.getX(i + 1), bz = pos.getZ(i + 1);
    const dx = pos.getX(i + 2), dz = pos.getZ(i + 2);
    area += Math.abs((bx - ax) * (dz - az) - (dx - ax) * (bz - az)) / 2;
  }
  return area;
}
const innerArea = polyArea(ol.inner);
const plateArea = polyArea(ol.platePts);
const lipCap = topCapArea('innerLip');
const frameCap = topCapArea('plateFrame');
const plateCap = topCapArea('plate');
ok(lipCap > 0 && lipCap / innerArea < 0.20, '内圈压边是真正的环（不是封板）', `占内腔 ${(lipCap / innerArea * 100).toFixed(1)}%`);
ok(frameCap > 0 && frameCap / plateArea < 0.20, '铁板压条是真正的环（不是封板）', `占铁板 ${(frameCap / plateArea * 100).toFixed(1)}%`);
const holeArea = ol.plateHoles.reduce((s, h) => s + polyArea(h), 0);
const expectCap = plateArea - holeArea;
ok(plateCap > 0 && Math.abs(plateCap - expectCap) / expectCap < 0.02,
  '铁板开窗被真实切穿（顶面 = 外形 − 各孔，且孔不重叠）', `切掉 ${(holeArea / plateArea * 100).toFixed(1)}%`);

// 琴弦：同音弦组内不得互相穿插，整组也不能宽到挤占相邻音（否则弦床糊成一块白板）。
const step = layout.totalWidth / (108 - 28);
const byMidi = new Map();
for (const s of ol.stringDefs) {
  if (!byMidi.has(s.midi)) byMidi.set(s.midi, []);
  byMidi.get(s.midi).push(s);
}
let selfClash = 0, crowd = 0;
for (const list of byMidi.values()) {
  list.sort((a, b) => a.x1 - b.x1);
  for (let i = 1; i < list.length; i++) {
    if (list[i].x1 - list[i - 1].x1 < list[i].radius + list[i - 1].radius) selfClash++;
  }
  if (list[list.length - 1].x1 - list[0].x1 > step * 0.9) crowd++;
}
ok(selfClash === 0, '同音弦彼此不穿插', `穿插 ${selfClash} 对`);
ok(crowd === 0, '同音弦组不挤占相邻音（弦床留有可见缝隙）', `过宽 ${crowd} 组`);
ok(ol.stringDefs.length > 200, '琴弦实例数', `${ol.stringDefs.length} 根`);

// 琴键按压测试
const k60 = piano.keys.get(60);
// 取键前/后缘顶面角点在 pivot 局部坐标里的位置，实测世界位移（带符号）。
// 注意：这里不能再用 Math.abs —— 之前就是因为取了绝对值，旋转符号写反
// 导致"按下时前缘上抬"的 bug 一直没被自检抓到。
const KEY_H = k60.topY - k60.pivotY;
const topCornerY = (localZ) => {
  piano.group.updateMatrixWorld(true);
  return new THREE.Vector3(0, KEY_H, localZ).applyMatrix4(k60.pivot.matrixWorld).y;
};
const frontRestY = topCornerY(k60.frontZ - k60.pivotZ);
const backRestY = topCornerY(k60.backZ - k60.pivotZ);
k60.target = 1;
for (let i = 0; i < 60; i++) piano.update(1 / 60);
const frontDownY = topCornerY(k60.frontZ - k60.pivotZ);
const backDownY = topCornerY(k60.backZ - k60.pivotZ);
const dFront = (frontDownY - frontRestY) * 1000;   // 前缘应为负（下沉）
const dBack = (backDownY - backRestY) * 1000;      // 后缘应为正（抬起）
ok(k60.press > 0.98, '按键动画在 1s 内到位', k60.press.toFixed(3));
ok(dFront < -9 && dFront > -13, '键前端下沉 ≈ 10mm（方向朝下）', dFront.toFixed(1) + 'mm');
ok(dBack > 3 && dBack < 7, '键后端抬起 ≈ 5mm（方向朝上）', '+' + dBack.toFixed(1) + 'mm');

// 击弦机：按下时槌头必须真正触到弦面（之前 SHANK_LEN 太短，停在离弦 44mm 处）
let hammerMesh = null;
piano.group.traverse((o) => { if (o.isInstancedMesh && piano.materials.feltWhite === o.material) hammerMesh = o; });
const hIdx = layout.keys.findIndex((kk) => kk.midi === 60);
const hMat = new THREE.Matrix4();
hammerMesh.getMatrixAt(hIdx, hMat);
hammerMesh.geometry.computeBoundingBox();
const hTopWorld = new THREE.Vector3(0, hammerMesh.geometry.boundingBox.max.y, 0)
  .applyMatrix4(hMat.premultiply(hammerMesh.matrixWorld));
ok(hTopWorld.y > 0.391 && hTopWorld.y < 0.401, '按键时槌头触弦（毡头顶入弦面）', hTopWorld.y.toFixed(3));
k60.target = 0;
for (let i = 0; i < 60; i++) piano.update(1 / 60);
ok(k60.press < 0.02, '松键后回弹', k60.press.toFixed(4));

// 制音器 / 顶盖 / 踏板
let damperOk = true;
try { piano.setDamper(60, true); piano.setDamper(60, false); } catch (e) { damperOk = false; }
ok(damperOk, '制音器抬起/落下接口可用（随按键联动）');
piano.updateLid(0);
ok(Math.abs(piano.lidProgress) < 1e-6, '顶盖可关闭');
piano.updateLid(1);
piano.setPedal(2, true);
for (let i = 0; i < 30; i++) piano.update(1 / 60);
ok(true, '踏板动画接口可用');

console.log('\n[5] 示范曲');
for (const s of DEMO_SONGS) {
  const bad = s.events.filter((e) => !(e.t >= 0 && e.d > 0 && e.m >= 28 && e.m <= 108 && e.v > 0 && e.v <= 1));
  const dur = Math.max(...s.events.map((e) => e.t + e.d));
  ok(bad.length === 0 && s.events.length > 10,
    `${s.name}`, `${s.events.length} 个音符 / ${dur.toFixed(1)}s`);
}

console.log(failed === 0 ? '\n✅ 全部自检通过\n' : `\n❌ ${failed} 项未通过\n`);
process.exit(failed === 0 ? 0 : 1);
