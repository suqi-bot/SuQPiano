// 临时诊断：铁板可用边界 + 开口候选适配情况
import { buildPiano } from '../src/scene/PianoModel.js';

const p = buildPiano({ startMidi: 28, endMidi: 108 });
const ol = p.outlines;

function inPoly(pts, x, z) {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i].y > z) !== (pts[j].y > z)
      && x < (pts[j].x - pts[i].x) * (z - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x) r = !r;
  }
  return r;
}

const fits = (pts, x, z) => inPoly(pts, x, z) && inPoly(pts, x - 0.012, z) && inPoly(pts, x + 0.012, z)
  && inPoly(pts, x, z - 0.012) && inPoly(pts, x, z + 0.012);

console.log('plate x range per z (with 12mm margin):');
for (const z of [-0.12, -0.15, -0.2, -0.3, -0.4, -0.46, -0.55, -0.6, -0.7, -0.8, -0.87, -0.93, -1.0, -1.05, -1.15, -1.2]) {
  let lo = -1;
  let hi = 2;
  for (let x = -0.1; x <= 1.3; x += 0.002) {
    if (fits(ol.platePts, x, z)) {
      if (lo < 0) lo = x;
      hi = x;
    }
  }
  console.log('  z=' + z.toFixed(2) + '  x ' + lo.toFixed(3) + ' .. ' + hi.toFixed(3));
}

console.log('plate y range per x:');
for (const x of [0.1, 0.2, 0.3, 0.45, 0.55, 0.65, 0.8, 0.9, 1.0]) {
  let lo = 1;
  let hi = -1;
  for (let z = -1.45; z <= 0.1; z += 0.002) {
    if (fits(ol.platePts, x, z)) {
      if (lo > 0.9) lo = z;
      hi = z;
    }
  }
  console.log('  x=' + x.toFixed(2) + '  z ' + lo.toFixed(3) + ' .. ' + hi.toFixed(3));
}

console.log('accepted holes ' + ol.plateHoles.length);
for (const h of ol.plateHoles) {
  const hx = h.map((q) => q.x);
  const hy = h.map((q) => q.y);
  console.log('  hole x ' + Math.min(...hx).toFixed(3) + ' .. ' + Math.max(...hx).toFixed(3)
    + '  y ' + Math.min(...hy).toFixed(3) + ' .. ' + Math.max(...hy).toFixed(3) + '  n=' + h.length);
}
