// 临时诊断：铁板开口候选 + 弦组宽度
import { buildPiano } from '../src/scene/PianoModel.js';
const p = buildPiano({ startMidi: 28, endMidi: 108 });
const ol = p.outlines;
console.log('plate bbox', (() => {
  const xs = ol.platePts.map((q) => q.x), ys = ol.platePts.map((q) => q.y);
  return `x ${Math.min(...xs).toFixed(3)}..${Math.max(...xs).toFixed(3)} y ${Math.min(...ys).toFixed(3)}..${Math.max(...ys).toFixed(3)}`;
})());
console.log('accepted holes', ol.plateHoles.length);
for (const h of ol.plateHoles) {
  const xs = h.map((q) => q.x), ys = h.map((q) => q.y);
  console.log('  hole', `x ${Math.min(...xs).toFixed(3)}..${Math.max(...xs).toFixed(3)}`,
    `y ${Math.min(...ys).toFixed(3)}..${Math.max(...ys).toFixed(3)}`, 'n=', h.length);
}
const step = 1.128 / 80;
const groups = new Map();
for (const s of ol.stringDefs) { if (!groups.has(s.midi)) groups.set(s.midi, []); groups.get(s.midi).push(s); }
for (const [midi, list] of groups) {
  const xs = list.map((s) => s.x1).sort((a, b) => a - b);
  const span = xs[xs.length - 1] - xs[0];
  if (span > step * 0.9) console.log('wide group midi', midi, 'n', list.length, 'span', span.toFixed(4), xs.map((v) => v.toFixed(3)).join(','));
}
console.log('string x range', Math.min(...ol.stringDefs.map((s) => s.x1)).toFixed(3), Math.max(...ol.stringDefs.map((s) => s.x1)).toFixed(3));
const last = ol.stringDefs[ol.stringDefs.length - 1];
console.log('max x group z1', last.z1, 'inside plate at x=1.06?', (() => {
  function inPoly(pts, x, z) { let r = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { if ((pts[i].y > z) !== (pts[j].y > z) && x < (pts[j].x - pts[i].x) * (z - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x) r = !r; } return r; }
  const out = [];
  for (const z of [-0.10, -0.12, -0.14, -0.16]) {
    let lo = 1.2; while (lo > 0 && !inPoly(ol.platePts, lo, z)) lo -= 0.005;
    let hi = 0; while (hi < 1.2 && !inPoly(ol.platePts, hi, z)) hi += 0.005;
    out.push(`z=${z}: x ${hi.toFixed(3)}..${lo.toFixed(3)}`);
  }
  return out.join('  ');
})());
