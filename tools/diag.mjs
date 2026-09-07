// 临时诊断：列出世界包围盒角落落在琴身外轮廓之外的 mesh（仅检查 z < -0.05 的区域）
import * as THREE from 'three';
import { buildPiano } from '../src/scene/PianoModel.js';

function cubicPoint(a, b, c, d, t) {
  const u = 1 - t;
  return new THREE.Vector2(
    u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
    u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y,
  );
}
function outlinePoints(width, depth) {
  const x0 = -0.048;
  const x1 = width + 0.048;
  const cx = width * 0.50;
  const points = [
    new THREE.Vector2(x0, 0.012),
    new THREE.Vector2(x1, 0.012),
    new THREE.Vector2(x1 + 0.004, -0.16),
  ];
  const a = points[points.length - 1];
  const d = new THREE.Vector2(cx + 0.08, -depth);
  for (let i = 1; i <= 9; i++) points.push(cubicPoint(a, new THREE.Vector2(x1 + 0.012, -0.56), new THREE.Vector2(x1 - 0.14, -1.16), d, i / 9));
  const a2 = points[points.length - 1];
  const d2 = new THREE.Vector2(x0 + 0.018, -1.26);
  for (let i = 1; i <= 9; i++) points.push(cubicPoint(a2, new THREE.Vector2(cx - 0.34, -depth + 0.02), new THREE.Vector2(x0 + 0.025, -1.12), d2, i / 9));
  points.push(new THREE.Vector2(x0 + 0.010, -0.88), new THREE.Vector2(x0 + 0.002, -0.48), new THREE.Vector2(x0, -0.20));
  return points;
}
function insidePoly(pts, x, z) {
  let ok = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i].y, yj = pts[j].y;
    if ((yi > z) !== (yj > z) && x < ((pts[j].x - pts[i].x) * (z - yi)) / (yj - yi) + pts[i].x) ok = !ok;
  }
  return ok;
}

const piano = buildPiano({});
const outer = outlinePoints(piano.layout.totalWidth, 1.42);
piano.group.updateMatrixWorld(true);
const bad = [];
const v = new THREE.Vector3();
const m4 = new THREE.Matrix4();
piano.group.traverse((o) => {
  if (!o.isMesh && !o.isInstancedMesh) return;
  let p = o, bench = false;
  while (p) { if (p.name === 'bench') bench = true; p = p.parent; }
  if (bench) return;
  const corners = [];
  const push = (mat) => {
    const attr = o.geometry.attributes.position;
    const stride = Math.max(1, Math.floor(attr.count / 300));
    for (let i = 0; i < attr.count; i += stride) {
      v.fromBufferAttribute(attr, i).applyMatrix4(mat).applyMatrix4(o.matrixWorld);
      corners.push([v.x, v.z]);
    }
  };
  if (o.isInstancedMesh) {
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); push(m4); }
  } else {
    push(new THREE.Matrix4());
  }
  for (const [x, z] of corners) {
    if (z < -0.05 && !insidePoly(outer, x, z)) {
      bad.push(`${o.type}/${o.material?.color?.getHexString?.() ?? '?'} @(${x.toFixed(3)},${z.toFixed(3)}) pos(${o.position.x.toFixed(2)},${o.position.y.toFixed(2)},${o.position.z.toFixed(2)})`);
      break;
    }
  }
});
console.log(bad.length ? bad.join('\n') : 'OK: 无构件穿出外轮廓');
