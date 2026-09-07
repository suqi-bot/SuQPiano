// 临时：从各视角预设向琴身内腔投射网格射线，统计首个命中体属于哪个材质。
// 这是不依赖浏览器的"内构是否真的看得见"客观判据。
import * as THREE from 'three';
import { buildPiano } from '../src/scene/PianoModel.js';

const p = buildPiano({ startMidi: 28, endMidi: 108 });
p.group.updateMatrixWorld(true);

// 材质 → 语义标签
const labelOf = new Map();
for (const [k, m] of Object.entries(p.materials)) labelOf.set(m.uuid, k);
const nameOf = (o) => {
  if (o.name) return o.name;
  return labelOf.get(o.material?.uuid) || 'other';
};

const b = p.bounds;
const cx = b.centerX, kw = b.width;
const views = {
  hero: { pos: [cx - 0.10, 1.72, 1.65], target: [cx, 0.26, -b.depth * 0.52] },
  top: { pos: [cx + kw * 0.95, 2.30, 0.85], target: [cx - 0.05, 0.40, -0.72] },
  full: { pos: [cx + 1.75, 1.55, 2.15], target: [cx, b.topY - 0.06, -b.depth * 0.45] },
  side: { pos: [cx - 2.3, 0.78, 0.15], target: [cx, b.topY - 0.04, -b.depth * 0.35] },
  hA: { pos: [cx + 0.35, 1.95, 1.75], target: [cx, 0.30, -0.80] },
  hB: { pos: [cx + 0.90, 1.80, 1.55], target: [cx - 0.05, 0.30, -0.75] },
  hD: { pos: [cx + 0.55, 2.05, 1.90], target: [cx, 0.30, -0.80] },
  hE: { pos: [cx + 0.30, 2.35, 1.35], target: [cx, 0.34, -0.72] },
  hF: { pos: [cx + 0.60, 1.95, 1.70], target: [cx - 0.02, 0.30, -0.78] },
  hG: { pos: [cx + 0.75, 1.88, 1.62], target: [cx - 0.03, 0.30, -0.76] },
  hH: { pos: [cx + 0.60, 1.95, 1.85], target: [cx - 0.02, 0.28, -0.80] },
  hI: { pos: [cx + 0.55, 1.85, 1.95], target: [cx - 0.02, 0.30, -0.80] },
  hJ: { pos: [cx + 0.45, 1.80, 2.05], target: [cx, 0.30, -0.78] },
};

// 内腔采样面：弦面 y=0.395，覆盖铁板范围
const samples = [];
for (let x = 0.10; x <= 1.05; x += 0.035) {
  for (let z = -0.15; z >= -1.30; z -= 0.035) samples.push(new THREE.Vector3(x, 0.395, z));
}

const rc = new THREE.Raycaster();
const dir = new THREE.Vector3();
for (const [vn, v] of Object.entries(views)) {
  const eye = new THREE.Vector3(...v.pos);
  const tally = new Map();
  let hits = 0;
  for (const s of samples) {
    dir.copy(s).sub(eye);
    const dist = dir.length();
    dir.normalize();
    rc.set(eye, dir);
    rc.far = dist + 0.5;
    const got = rc.intersectObject(p.group, true);
    if (!got.length) continue;
    hits++;
    const key = got[0].object.name || labelOf.get(got[0].object.material?.uuid) || 'other';
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  const rows = [...tally.entries()].sort((a, b2) => b2[1] - a[1])
    .map(([k, n]) => `${k}=${((n / samples.length) * 100).toFixed(1)}%`);
  const inner = ['steel', 'copper', 'plate', 'soundboard', 'bridge', 'feltDark', 'feltWhite', 'brass'];
  let innerPct = 0;
  for (const [k, n] of tally) if (inner.includes(k)) innerPct += n / samples.length * 100;
  console.log(`${vn.padEnd(5)} samples=${samples.length} hit=${hits} inner=${innerPct.toFixed(1)}%  ${rows.join('  ')}`);

  // 构图检查：把琴身包围盒 8 个角点投影到屏幕，NDC 绝对值应 < 1（含 16:9 与 1:1 两种比例）
  for (const [an, aspect] of [['16:9', 16 / 9], ['1:1', 1.0]]) {
    const cam = new THREE.PerspectiveCamera(42, aspect, 0.05, 60);
    cam.position.set(...v.pos);
    cam.lookAt(...v.target);
    cam.updateMatrixWorld(true);
    const box = new THREE.Box3();
    p.group.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      let q = o, skip = false;
      while (q) { if (q.name === 'bench') skip = true; q = q.parent; }
      if (!skip) box.union(new THREE.Box3().setFromObject(o));
    });
    let mx = 0, my = 0, behind = 0;
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Vector3(i & 1 ? box.min.x : box.max.x, i & 2 ? box.min.y : box.max.y, i & 4 ? box.min.z : box.max.z);
      const d = c.clone().project(cam);
      if (c.clone().applyMatrix4(cam.matrixWorldInverse).z > 0) behind++;
      mx = Math.max(mx, Math.abs(d.x)); my = Math.max(my, Math.abs(d.y));
    }
    console.log(`      ${an} ndcX=${mx.toFixed(2)} ndcY=${my.toFixed(2)} behind=${behind}`);
  }
}
