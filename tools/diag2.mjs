// 临时诊断：内腔构件（琴弦 / 铁板 / 音板 / 槌头 / 制音器）的空间统计
import * as THREE from 'three';
import { buildPiano } from '../src/scene/PianoModel.js';

const piano = buildPiano({});
piano.group.updateMatrixWorld(true);

const m4 = new THREE.Matrix4();
const local = new THREE.Box3();
const world = new THREE.Box3();
const one = new THREE.Box3();
const v = new THREE.Vector3();

function boundsOf(o) {
  local.copy(o.geometry.boundingBox ?? o.geometry.computeBoundingBox() ?? o.geometry.boundingBox);
  world.makeEmpty();
  if (o.isInstancedMesh) {
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m4);
      one.copy(local).applyMatrix4(m4.premultiply(o.matrixWorld));
      world.union(one);
    }
  } else {
    world.copy(local).applyMatrix4(o.matrixWorld);
  }
  return world;
}

const report = [];
piano.group.traverse((o) => {
  if (!o.isMesh && !o.isInstancedMesh) return;
  if (!o.geometry) return;
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
  const c = o.material?.color;
  const hex = c ? '0x' + c.getHexString() : '?';
  const meta = `r${o.material?.roughness ?? '-'} m${o.material?.metalness ?? '-'}`;
  const b = boundsOf(o);
  report.push({
    hex, meta, type: o.type, n: o.count ?? 1,
    y: `${b.min.y.toFixed(3)}~${b.max.y.toFixed(3)}`,
    z: `${b.min.z.toFixed(3)}~${b.max.z.toFixed(3)}`,
    x: `${b.min.x.toFixed(3)}~${b.max.x.toFixed(3)}`,
  });
});
report.sort((a, b) => a.y.localeCompare(b.y));
for (const r of report) {
  console.log(`${r.hex} ${r.meta.padEnd(12)} ${r.type.padEnd(14)} n=${String(r.n).padEnd(4)} y=${r.y} z=${r.z} x=${r.x}`);
}
