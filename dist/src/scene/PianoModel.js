/**
 * PianoModel — clean-room grand-piano model.
 *
 * 坐标约定：X=键盘左右，Y=高度，+Z=演奏者方向。
 * 这个文件不复用旧版的轮廓偏移、复杂布尔几何或悬空结构，
 * 采用明确的分层结构：琴身 / 音板 / 铁板 / 键盘 / 击弦机 / 制音器 / 琴盖 / 踏板。
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { computeKeyLayout } from '../core/NoteUtils.js';

const FLOOR_Y = -0.50;
const KEY_TOP = 0.22;
const KEY_H = 0.022;
const BLACK_H = 0.0145;
const BLACK_SINK = 0.0015;   // 黑键底面压进白键顶面的深度（避免共面闪烁）；露出白键面 ≈ 13mm，与真琴一致
const BLACK_BODY_H = 0.055;  // 键帽下方的键体高度：埋进键床，按下时填补键帽抬升后露出的空隙
const BLACK_SLOT = 0.0009;   // 白键键槽与黑键之间的单边间隙
const KEY_FRONT_Z = 0.158;
const KEY_BACK_Z = 0.004;
const BALANCE_Z = 0.052;
const RIM_TOP = 0.44;
const LID_PIVOT_Y = RIM_TOP + 0.010;      // 琴盖铰链轴高度
const LID_THICK = 0.026;                  // 琴盖板厚
const LID_UNDER_Y = LID_PIVOT_Y - LID_THICK; // 闭合时琴盖底面：内构零件不得超过这条线
const SOUND_TOP = 0.300;
const PLATE_TOP = 0.352;
const STRING_Y = 0.395;
const BRIDGE_TREBLE_Z = -0.460;
const BRIDGE_BASS_Z = -0.930;

function matPhysical(color, roughness, metalness = 0, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness, metalness,
    envMapIntensity: 1.0,
    ...extra,
  });
}

function createMaterials() {
  return {
    ebony: matPhysical(0x08090d, 0.16, 0.02, { clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.6 }),
    ebonySat: matPhysical(0x17191f, 0.30, 0.03, { clearcoat: 0.45, clearcoatRoughness: 0.18 }),
    whiteKey: matPhysical(0xf3f0e8, 0.25, 0.02, { clearcoat: 0.35, clearcoatRoughness: 0.16 }),
    blackKey: matPhysical(0x11131a, 0.20, 0.02, { clearcoat: 0.85, clearcoatRoughness: 0.10 }),
    felt: new THREE.MeshStandardMaterial({ color: 0x7e1c2b, roughness: 0.96 }),
    feltWhite: new THREE.MeshStandardMaterial({ color: 0xf0eee2, roughness: 0.86 }),
    feltDark: new THREE.MeshStandardMaterial({ color: 0x342331, roughness: 0.92 }),
    soundboard: matPhysical(0xb87943, 0.58, 0.02, { clearcoat: 0.18, clearcoatRoughness: 0.42 }),
    woodLight: matPhysical(0x8f522d, 0.54, 0.02),
    bridge: matPhysical(0x6d3a1c, 0.50, 0.02, { clearcoat: 0.20, clearcoatRoughness: 0.35 }),
    plate: matPhysical(0x9a7230, 0.46, 0.55, { clearcoat: 0.30, clearcoatRoughness: 0.18, envMapIntensity: 1.25 }),
    brass: matPhysical(0xb28a38, 0.25, 0.82, { clearcoat: 0.20, clearcoatRoughness: 0.16 }),
    steel: matPhysical(0xf6f9fd, 0.16, 0.52, { envMapIntensity: 2.0 }),
    copper: matPhysical(0xc2793f, 0.30, 0.62, { envMapIntensity: 1.6 }),
    leather: matPhysical(0x25252a, 0.62, 0.02, { clearcoat: 0.16 }),
    _screw: matPhysical(0x25262b, 0.34, 0.76),
  };
}

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
  // 高音侧外缘到尾部的长圆弧，贴近参考图中的翼形外轮廓。
  const a = points[points.length - 1];
  const d = new THREE.Vector2(cx + 0.08, -depth);
  for (let i = 1; i <= 9; i++) points.push(cubicPoint(
    a,
    new THREE.Vector2(x1 + 0.012, -0.56),
    new THREE.Vector2(x1 - 0.14, -1.16),
    d,
    i / 9,
  ));
  // 低音侧回到键盘前沿，避免尖角和突然的折返。
  const a2 = points[points.length - 1];
  const d2 = new THREE.Vector2(x0 + 0.018, -1.26);
  for (let i = 1; i <= 9; i++) points.push(cubicPoint(
    a2,
    new THREE.Vector2(cx - 0.34, -depth + 0.02),
    new THREE.Vector2(x0 + 0.025, -1.12),
    d2,
    i / 9,
  ));
  points.push(
    new THREE.Vector2(x0 + 0.010, -0.88),
    new THREE.Vector2(x0 + 0.002, -0.48),
    new THREE.Vector2(x0, -0.20),
  );
  return points;
}

/** 沿角平分线把闭合轮廓向内偏移 inset（等宽）。 */
function offsetPolygon(points, inset) {
  // 内法线方向取决于绕向：CCW 时每条有向边的左侧就是内侧。
  const dir = signedArea2(points) > 0 ? 1 : -1;
  const n = points.length;
  const result = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const e1 = new THREE.Vector2(p.x - prev.x, p.y - prev.y).normalize();
    const e2 = new THREE.Vector2(next.x - p.x, next.y - p.y).normalize();
    const nx1 = -e1.y * dir, ny1 = e1.x * dir;
    const nx2 = -e2.y * dir, ny2 = e2.x * dir;
    const mx = nx1 + nx2;
    const my = ny1 + ny2;
    const len = Math.hypot(mx, my);
    if (len < 1e-6) { result.push(new THREE.Vector2(p.x, p.y)); continue; }
    // miter 长 = inset / cos(θ/2)，限幅到 3×inset 避免尖角处伸出长刺。
    const m = Math.min(inset * 3, (inset * 2) / len);
    result.push(new THREE.Vector2(p.x + (mx / len) * m, p.y + (my / len) * m));
  }
  return result;
}

/**
 * 把轮廓向内收一圈，且保证结果严格嵌套（可安全地当作环的内孔）。
 *
 * 旧实现在 y<-0.02 分支上按 0.925 缩放 y：对第二次、第三次调用的轮廓来说，
 * 前缘点会被推向演奏者（即轮廓之外），于是 ringGeometry 的内孔跑到外形之外，
 * ExtrudeGeometry 的 earcut 直接丢弃这个孔，环退化成整块实心板，
 * 从 y=0.42 与 y=0.37 两层把音板/琴弦/击弦机全部盖住 —— 就是"内构不显示"的根因。
 */
function insetPoints(points, inset = 0.05) {
  let pts = offsetPolygon(points, inset);
  const c = centroid2(points);
  // 非凸轮廓（翼形弯侧与直边交接处）上偏移可能把点甩到母轮廓之外，
  // 所以再整体向质心微量收缩，直到每个顶点都严格落在内部。
  for (let guard = 0; guard < 40 && !pts.every((p) => insidePoly(points, p.x, p.y)); guard++) {
    pts = pts.map((p) => new THREE.Vector2(c.x + (p.x - c.x) * 0.995, c.y + (p.y - c.y) * 0.995));
  }
  return pts;
}

function centroid2(points) {
  const s = points.reduce((acc, p) => acc.add(p), new THREE.Vector2());
  return s.multiplyScalar(1 / points.length);
}

/**
 * ExtrudeGeometry 是“非索引”几何，three 的 computeVertexNormals() 只能给出逐面法线，
 * 于是琴身弯侧 / 琴盖边缘这些曲面会渲染成一条条硬边平板。
 * 这里按位置合并顶点后、只在夹角小于 crease 的面之间平均法线：
 * 曲面恢复光滑，而顶面与侧壁之间的真实硬边（≈90°）依旧保持锐利。
 */
function smoothCreasedNormals(geo, crease = Math.PI / 5) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  if (!pos || !nrm) return geo;
  const q = 1e5;
  const buckets = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    const list = buckets.get(k);
    if (list) list.push(i); else buckets.set(k, [i]);
  }
  const cosCrease = Math.cos(crease);
  const out = new Float32Array(nrm.count * 3);
  const v = new THREE.Vector3();
  for (const list of buckets.values()) {
    for (const i of list) {
      const fx = nrm.getX(i), fy = nrm.getY(i), fz = nrm.getZ(i);
      let nx = 0, ny = 0, nz = 0;
      for (const j of list) {
        const dot = fx * nrm.getX(j) + fy * nrm.getY(j) + fz * nrm.getZ(j);
        if (dot >= cosCrease) { nx += nrm.getX(j); ny += nrm.getY(j); nz += nrm.getZ(j); }
      }
      v.set(nx, ny, nz);
      if (v.lengthSq() < 1e-12) v.set(fx, fy, fz); else v.normalize();
      out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    }
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return geo;
}

/** 圆角多边形轮廓：每个角点用半径 r 的二次曲线倒角（键帽/白键的圆角靠它做）。 */
function roundedShape(pts, r = 0.0022) {
  const s = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const d1 = new THREE.Vector2(prev.x - p.x, prev.y - p.y);
    const d2 = new THREE.Vector2(next.x - p.x, next.y - p.y);
    const l1 = d1.length(), l2 = d2.length();
    if (l1 < 1e-9 || l2 < 1e-9 || Math.abs((d1.x * d2.y - d1.y * d2.x) / (l1 * l2)) < 1e-6) {
      if (i === 0) s.moveTo(p.x, p.y); else s.lineTo(p.x, p.y);   // 共线点：直接连线
      continue;
    }
    const t = Math.min(r, l1 * 0.5, l2 * 0.5);
    const a = new THREE.Vector2(p.x + (d1.x / l1) * t, p.y + (d1.y / l1) * t);
    const b = new THREE.Vector2(p.x + (d2.x / l2) * t, p.y + (d2.y / l2) * t);
    if (i === 0) s.moveTo(a.x, a.y); else s.lineTo(a.x, a.y);
    s.quadraticCurveTo(p.x, p.y, b.x, b.y);
  }
  s.closePath();
  return s;
}

/**
 * 把 X/Z 平面轮廓按精确尺寸挤出成 Y 方向几何（轮廓第二坐标使用 -Z）。
 * 注意：不能用 ExtrudeGeometry 的 bevel —— bevel 是把轮廓向外扩，会让键帽/键槽宽度全部走样。
 * 圆角改由 roundedShape() 在轮廓上做，挤出后以中心为原点，与 RoundedBoxGeometry 用法一致。
 */
function prismGeometry(shape, height) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: false, curveSegments: 6, steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
  smoothCreasedNormals(geo);
  return geo;
}

/** 圆角矩形轮廓（宽度沿 X、长度沿 Z）。 */
function keyRectShape(width, length, r = 0.0022) {
  const hw = width / 2, hl = length / 2;
  return roundedShape([
    new THREE.Vector2(-hw, -hl), new THREE.Vector2(hw, -hl),
    new THREE.Vector2(hw, hl), new THREE.Vector2(-hw, hl),
  ], r);
}

/** 把 X/Z 平面轮廓挤出成 Y 方向几何。轮廓第二坐标使用 -Z。 */
function extrudedPlanar(points, height, bevel = 0) {
  const shape = new THREE.Shape();
  points.forEach((p, i) => i ? shape.lineTo(p.x, -p.y) : shape.moveTo(p.x, -p.y));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 2,
    steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  smoothCreasedNormals(geo);
  return geo;
}

/**
 * 带任意个内孔的面板，挤出成 Y 方向几何。
 * 所有孔必须严格落在外轮廓内部，否则 earcut 会静默丢孔、面板退化成实心板。
 */
function slabGeometry(outerPts, holePtsList, height) {
  const shape = new THREE.Shape();
  outerPts.forEach((p, i) => (i ? shape.lineTo(p.x, -p.y) : shape.moveTo(p.x, -p.y)));
  shape.closePath();
  for (const holePts of holePtsList) {
    const hole = new THREE.Path();
    [...holePts].reverse().forEach((p, i) => (i ? hole.lineTo(p.x, -p.y) : hole.moveTo(p.x, -p.y)));
    hole.closePath();
    shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 2, steps: 1 });
  geo.rotateX(-Math.PI / 2);
  smoothCreasedNormals(geo);
  return geo;
}

function ringGeometry(outer, inner, height) {
  return slabGeometry(outer, [inner], height);
}

/** 圆角矩形孔，点序与 outlinePoints 同向（外轮廓 -> 近端左 -> 近端右 -> 远端右 -> 远端左）。 */
function rectPts(x0, x1, yNear, yFar, r = 0.014, seg = 3) {
  const pts = [];
  const arc = (cx, cy, a0, a1) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg);
      pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
  };
  arc(x0 + r, yNear - r, Math.PI, Math.PI / 2);
  arc(x1 - r, yNear - r, Math.PI / 2, 0);
  arc(x1 - r, yFar + r, 0, -Math.PI / 2);
  arc(x0 + r, yFar + r, -Math.PI / 2, -Math.PI);
  return pts;
}

/** 圆孔（铁板上的 hand hole），点序同上。 */
function circlePts(cx, cy, radius, seg = 14) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = -(Math.PI * 2 * i) / seg;
    pts.push(new THREE.Vector2(cx + radius * Math.cos(a), cy + radius * Math.sin(a)));
  }
  return pts;
}

/** 把一组孔点向自身质心缩到完全落进 poly 内部（含 margin 安全边距）；失败返回 null。 */
function shrinkInside(pts, poly, margin = 0.010) {
  const c = centroid2(pts);
  let k = 1;
  for (let step = 0; step < 40; step++) {
    const cand = pts.map((p) => new THREE.Vector2(c.x + (p.x - c.x) * k, c.y + (p.y - c.y) * k));
    let fits = true;
    for (const p of cand) {
      if (!insidePoly(poly, p.x, p.y)
        || !insidePoly(poly, p.x - margin, p.y) || !insidePoly(poly, p.x + margin, p.y)
        || !insidePoly(poly, p.x, p.y - margin) || !insidePoly(poly, p.x, p.y + margin)) {
        fits = false;
        break;
      }
    }
    if (fits) return cand;
    k *= 0.93;
    if (k < 0.05) return null;
  }
  return null;
}

/** 点 (x, z) 是否在 X/Z 平面轮廓多边形内（轮廓第二坐标即 z）。 */
function insidePoly(pts, x, z) {
  let ok = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i].y;
    const yj = pts[j].y;
    if ((yi > z) !== (yj > z) && x < ((pts[j].x - pts[i].x) * (z - yi)) / (yj - yi) + pts[i].x) ok = !ok;
  }
  return ok;
}

function signedArea2(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return s / 2;
}

/**
 * 两个凸多边形的最短分离距离（SAT）；负值表示已经互相重叠。
 * ExtrudeGeometry 遇到互相重叠的内孔会直接吐出错误的剖分，所以孔之间必须留出间隙。
 */
function convexGap(a, b) {
  let gap = -Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = q.y - p.y;
      const ny = p.x - q.x;
      const len = Math.hypot(nx, ny) || 1;
      const ux = nx / len;
      const uy = ny / len;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of a) { const t = v.x * ux + v.y * uy; if (t < a0) a0 = t; if (t > a1) a1 = t; }
      for (const v of b) { const t = v.x * ux + v.y * uy; if (t < b0) b0 = t; if (t > b1) b1 = t; }
      const g = Math.max(a0 - b1, b0 - a1);
      if (g > gap) gap = g;
    }
  }
  return gap;
}

/**
 * 铸铁板上的开口：前弦床窗、中段左/右窗、尾部窗、两个 hand hole。
 * 实体布局按真琴：前缘销列带、琴码所在横带、以及中缝与外周边缘保持实心，
 * 开口只放在带与带之间。每个孔都先由 shrinkInside 缩进 platePts 内部，
 * 再要求与其他孔至少留 20mm 间隙，保证 earcut 不会丢孔、也不会产生自交剖分。
 * y 坐标与 outlinePoints 一致（越负越靠琴尾）。
 */
function buildPlateOpenings(platePts) {
  const candidates = [
    rectPts(0.14, 0.98, -0.150, -0.500, 0.024),   // 前弦床窗：让出琴销列与琴码，可直接看到击弦机/制音器
    rectPts(0.12, 0.46, -0.640, -0.890, 0.022),   // 低音中段窗
    rectPts(0.64, 0.88, -0.640, -0.890, 0.022),   // 高音中段窗
    rectPts(0.32, 0.72, -1.020, -1.130, 0.020),   // 尾部窗
    circlePts(0.55, -0.560, 0.030),               // hand hole（中缝实心带）
    circlePts(0.55, -0.955, 0.030),               // hand hole（中缝实心带）
  ];
  const holes = [];
  for (const pts of candidates) {
    const fit = shrinkInside(pts, platePts, 0.012);
    if (!fit || Math.abs(signedArea2(fit)) < 0.0012) continue;
    if (holes.some((h) => convexGap(fit, h) < 0.020)) continue;
    holes.push(fit);
  }
  return holes;
}

function box(w, h, d, material, radius = 0) {
  const geo = radius > 0
    ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, Math.min(w, h, d) * 0.45))
    : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 琴码：底座 + 码桥，码桥顶面刚好托住弦面（而不是旧版那堵 10cm 高的方墙）。
 * 沿 X 按 angle 斜置在 z 处。
 */
function buildBridge(z, length, angle, centerX, M) {
  const capH = 0.012;
  const capTop = STRING_Y - 0.0022;
  const baseH = Math.max(0.010, capTop - capH - SOUND_TOP);
  const g = new THREE.Group();
  const base = box(length, baseH, 0.026, M.woodLight, 0.003);
  base.position.y = SOUND_TOP + baseH / 2;
  const cap = box(length, capH, 0.019, M.bridge, 0.002);
  cap.position.y = SOUND_TOP + baseH + capH / 2;
  g.add(base, cap);
  // 码钉：弦跨过琴码时被这几根小铜钉压住。
  const pinCount = Math.max(3, Math.round(length / 0.085));
  const pins = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.0022, 0.0026, 0.014, 6), M.brass, pinCount,
  );
  for (let i = 0; i < pinCount; i++) {
    const px = -length / 2 + length * (i + 0.5) / pinCount;
    pins.setMatrixAt(i, new THREE.Matrix4().makeTranslation(px, capTop + 0.004, 0));
  }
  pins.instanceMatrix.needsUpdate = true;
  g.add(pins);
  g.position.set(centerX, 0, z);
  g.rotation.y = angle;
  return g;
}

function cylinderBetween(a, b, radius, material, segments = 8) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), segments), material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function orientInstancedCylinder(mesh, i, a, b, radius = 1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const m = new THREE.Matrix4().compose(
    a.clone().addScaledVector(dir, 0.5), q, new THREE.Vector3(radius, dir.length(), radius),
  );
  mesh.setMatrixAt(i, m);
}

export function buildPiano({ startMidi = 28, endMidi = 108 } = {}) {
  const M = createMaterials();
  const root = new THREE.Group();
  root.name = 'GrandPiano_Rebuilt';

  const layout = computeKeyLayout(startMidi, endMidi);
  const KW = layout.totalWidth;
  const cx = KW / 2;
  const DEPTH = 1.42;
  const outer = outlinePoints(KW, DEPTH);
  const inner = insetPoints(outer);

  // 1) 分层琴身：底板 + 厚实外圈 + 顶部压边。没有重叠的异常偏移多边形。
  const shell = new THREE.Mesh(ringGeometry(outer, inner, RIM_TOP), M.ebony);
  shell.name = 'shell';
  shell.castShadow = true; shell.receiveShadow = true;
  root.add(shell);

  const bottom = new THREE.Mesh(extrudedPlanar(outer, 0.026, 0.002), M.ebonySat);
  bottom.position.y = -0.026;
  bottom.castShadow = true; bottom.receiveShadow = true;
  root.add(bottom);

  // 内圈压边木条：贴在内壁顶口的一圈窄木条（现在才是真正的环，不再退化成封板）。
  const lipInner = insetPoints(inner, 0.014);
  const innerLip = new THREE.Mesh(ringGeometry(inner, lipInner, 0.018), M.woodLight);
  innerLip.name = 'innerLip';
  innerLip.position.y = RIM_TOP - 0.020;
  innerLip.castShadow = true;
  root.add(innerLip);

  // 音板：几乎铺满内腔（真琴音板是粘在 rim 内口上的）。
  const soundboardPts = insetPoints(inner, 0.012);
  const soundboard = new THREE.Mesh(extrudedPlanar(soundboardPts, 0.014, 0.001), M.soundboard);
  soundboard.name = 'soundboard';
  soundboard.position.y = SOUND_TOP - 0.014;
  soundboard.receiveShadow = true;
  root.add(soundboard);

  // 铸铁板：落在音板上方，带大型开口，透过开口能看到音板与肋木。
  const platePts = insetPoints(soundboardPts, 0.026);
  const plateHoles = buildPlateOpenings(platePts);
  const plate = new THREE.Mesh(slabGeometry(platePts, plateHoles, 0.018), M.plate);
  plate.name = 'plate';
  plate.position.y = PLATE_TOP - 0.018;
  plate.castShadow = true;
  plate.receiveShadow = true;
  root.add(plate);

  // 铁板外缘的木色压条：明确显示铁板坐在音板之上、与 rim 之间留有木边。
  const plateFramePts = insetPoints(platePts, 0.012);
  const plateFrame = new THREE.Mesh(ringGeometry(platePts, plateFramePts, 0.006), M.woodLight);
  plateFrame.name = 'plateFrame';
  plateFrame.position.y = PLATE_TOP;
  root.add(plateFrame);

  // 音板肋木：在音板下侧（从下方才看得到，与真琴一致），右端逐根向内收缩以免穿出弯侧 rim。
  for (let i = 0; i < 9; i++) {
    const z = -0.28 - i * 0.125;
    let x0r = 0.02;
    while (x0r < cx && !insidePoly(soundboardPts, x0r + 0.015, z)) x0r += 0.04;
    let x1r = cx + KW * 0.45;
    while (x1r > x0r + 0.1 && !insidePoly(soundboardPts, x1r - 0.015, z)) x1r -= 0.04;
    if (x1r - x0r < 0.12) continue; // 尾部内腔过窄处不放肋木
    const rib = box(x1r - x0r, 0.016, 0.018, M.woodLight, 0.003);
    rib.position.set((x0r + x1r) / 2, SOUND_TOP - 0.014 - 0.008, z);
    root.add(rib);
  }
  const bridgeA = buildBridge(BRIDGE_TREBLE_Z, KW * 0.72, -0.10, cx, M);
  root.add(bridgeA);
  let bbW = KW * 0.50;
  while (bbW > 0.2) {
    const hx = (bbW / 2) * Math.cos(0.14);
    const hz = (bbW / 2) * Math.sin(0.14);
    if (insidePoly(soundboardPts, cx - KW * 0.12 + hx, BRIDGE_BASS_Z - hz)
      && insidePoly(soundboardPts, cx - KW * 0.12 - hx, BRIDGE_BASS_Z + hz)) break;
    bbW -= 0.04;
  }
  const bridgeB = buildBridge(BRIDGE_BASS_Z, bbW, 0.14, cx - KW * 0.12, M);
  root.add(bridgeB);

  // 铁板横肋（casting ribs）：沿 X 跨在开口上的铸接肋条，位置错开琴码与 hand hole。
  for (const [z, w] of [[-0.235, 0.022], [-0.620, 0.022], [-1.180, 0.016]]) {
    let x0b = 0.06;
    while (x0b < cx && !insidePoly(platePts, x0b, z)) x0b += 0.03;
    let x1b = cx + KW * 0.46;
    while (x1b > x0b + 0.1 && !insidePoly(platePts, x1b, z)) x1b -= 0.03;
    if (x1b - x0b < 0.14) continue;
    const beam = box(x1b - x0b, 0.022, w, M.plate, 0.004);
    beam.position.set((x0b + x1b) / 2, PLATE_TOP + 0.011, z);
    beam.castShadow = true;
    root.add(beam);
  }

  // 2) 琴弦、调律钉、挂弦钉。所有端点都限制在铁板内。
  //    弦径/同音间距必须按真琴量级：旧版弦径 3.6~9.6mm 却只隔 4.5mm，相邻弦互相穿插，
  //    从上方看下去整片弦床糊成一块实心白板，反而看不出“内构”。
  const stringDefs = [];
  const sx0 = 0.088;
  for (const k of layout.keys) {
    const t = (k.midi - startMidi) / Math.max(1, endMidi - startMidi);
    const f = 440 * Math.pow(2, (k.midi - 69) / 12);
    const low = k.midi < 52;
    const count = k.midi < 36 ? 2 : (k.midi < 60 ? 2 : 3);
    const len = Math.min(1.30, Math.max(0.34, 1.18 * Math.pow(440 / f, 0.43)));
    const radius = k.midi < 44 ? 0.0026 : (k.midi < 52 ? 0.0021 : (k.midi < 64 ? 0.0015 : (k.midi < 76 ? 0.0012 : 0.0010)));
    // 同音间距必须同时满足：大于弦径（不互相穿插）、又小于半音间距（不挤占相邻音）。
    // 本琴平均每半音只占 14.1mm，三弦组的总宽必须控制在 10mm 以内。
    const unison = k.midi < 44 ? 0.0100 : (k.midi < 60 ? 0.0070 : 0.0045);
    for (let u = 0; u < count; u++) {
      const off = (u - (count - 1) / 2) * unison;
      let x1 = sx0 + t * (KW - sx0 * 2) + off + (low ? (52 - k.midi) * 0.0018 : 0);
      const z1 = -0.12 - (low ? 0.02 : 0);
      while (x1 > 0.1 && !insidePoly(platePts, x1, z1)) x1 -= 0.02;
      let x2 = low ? Math.max(0.07, x1 - 0.11) : x1;
      let z2 = Math.max(-1.30, -0.12 - len);
      // 翼形尾部使铁板边界向左收窄，低音弦后端要同时向内绕才能落在板上。
      while (z2 < -0.25 && !insidePoly(platePts, x2, z2)) {
        z2 += 0.03;
        if (low) x2 += 0.012;
      }
      stringDefs.push({ midi: k.midi, x1, x2, radius, copper: low, z1, z2 });
    }
  }
  const stringGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  const copperDefs = stringDefs.filter((s) => s.copper);
  const steelDefs = stringDefs.filter((s) => !s.copper);
  const copperStrings = new THREE.InstancedMesh(stringGeo, M.copper, copperDefs.length);
  const steelStrings = new THREE.InstancedMesh(stringGeo, M.steel, steelDefs.length);
  for (const [mesh, defs] of [[copperStrings, copperDefs], [steelStrings, steelDefs]]) {
    defs.forEach((s, i) => orientInstancedCylinder(mesh, i,
      new THREE.Vector3(s.x1, STRING_Y, s.z1), new THREE.Vector3(s.x2, STRING_Y, s.z2), s.radius));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
  }
  root.add(copperStrings, steelStrings);

  const tuningPins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.002, 0.0022, 0.028, 8), M.brass, stringDefs.length);
  const hitchPins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0018, 0.002, 0.024, 8), M.brass, stringDefs.length);
  stringDefs.forEach((s, i) => {
    tuningPins.setMatrixAt(i, new THREE.Matrix4().makeTranslation(s.x1, PLATE_TOP + 0.022, s.z1));
    hitchPins.setMatrixAt(i, new THREE.Matrix4().makeTranslation(s.x2, PLATE_TOP + 0.020, s.z2));
  });
  tuningPins.instanceMatrix.needsUpdate = true; hitchPins.instanceMatrix.needsUpdate = true;
  root.add(tuningPins, hitchPins);

  // 3) 击弦机：槌柄轨道、槌头和动作舱。
  const hammerRailY = 0.292;
  const hammerRailZ = -0.105;
  const hammerLen = 0.108;
  const hammerRest = { y: 0.342, z: -0.178 };
  const hammerHit = { y: 0.389, z: -0.105 };
  const hammerGeo = new RoundedBoxGeometry(0.014, hammerLen, 0.018, 2, 0.0022);
  hammerGeo.translate(0, hammerLen / 2, 0);
  const hammers = new THREE.InstancedMesh(hammerGeo, M.feltWhite, layout.keys.length);
  const restAngle = Math.atan2(hammerRest.z - hammerRailZ, hammerRest.y - hammerRailY);
  const hitAngle = Math.atan2(hammerHit.z - hammerRailZ, hammerHit.y - hammerRailY);
  const maxHammerAngle = hitAngle - restAngle;
  const hammerQ = new THREE.Quaternion();
  const hammerM = new THREE.Matrix4();
  function refreshHammers(presses) {
    layout.keys.forEach((k, i) => {
      hammerQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), restAngle + (presses[i] || 0) * maxHammerAngle);
      hammerM.compose(new THREE.Vector3(k.centerX, hammerRailY, hammerRailZ), hammerQ, new THREE.Vector3(1, 1, 1));
      hammers.setMatrixAt(i, hammerM);
    });
    hammers.instanceMatrix.needsUpdate = true;
  }
  const pressArr = new Array(layout.keys.length).fill(0);
  refreshHammers(pressArr);
  hammers.castShadow = true;
  root.add(hammers);

  const actionBay = box(KW * 0.96, 0.10, 0.22, M.ebonySat, 0.008);
  actionBay.position.set(cx, 0.208, -0.14);
  root.add(actionBay);
  const rail = box(KW * 0.94, 0.014, 0.030, M.ebonySat, 0.004);
  rail.position.set(cx, hammerRailY - 0.006, hammerRailZ);
  root.add(rail);

  // 4) 制音器：每个键一组制音头和制音杆，严格跟随踏板抬升。
  const damperHeadGeo = new RoundedBoxGeometry(0.012, 0.022, 0.030, 2, 0.002);
  const dampers = new THREE.InstancedMesh(damperHeadGeo, M.feltDark, layout.keys.length);
  const damperLeverGeo = new THREE.CylinderGeometry(0.0017, 0.0017, 1, 6);
  const damperLevers = new THREE.InstancedMesh(damperLeverGeo, M.ebonySat, layout.keys.length);
  const damperDefs = layout.keys.map((k) => {
    let x = sx0 + ((k.midi - startMidi) / Math.max(1, endMidi - startMidi)) * (KW - sx0 * 2);
    while (x > 0.1 && !insidePoly(platePts, x, -0.30)) x -= 0.02;
    return { midi: k.midi, x, lifted: false };
  });
  const damperIndex = new Map(damperDefs.map((d, i) => [d.midi, i]));
  function refreshDampers() {
    damperDefs.forEach((d, i) => {
      // 制音头毡面坐在弦面之上（而不是穿进弦床），抬起时整体升高。
      const y = STRING_Y + 0.008 + (d.lifted ? 0.026 : 0);
      dampers.setMatrixAt(i, new THREE.Matrix4().makeTranslation(d.x, y, -0.30));
      const a = new THREE.Vector3(d.x, 0.215, -0.04);
      const b = new THREE.Vector3(d.x, y - 0.011, -0.30);
      orientInstancedCylinder(damperLevers, i, a, b);
    });
    dampers.instanceMatrix.needsUpdate = true;
    damperLevers.instanceMatrix.needsUpdate = true;
  }
  refreshDampers();
  dampers.castShadow = true;
  root.add(dampers, damperLevers);

  // 5) 键盘和键后结构。所有键独立 pivot，黑键底面放在白键顶面，不相互穿插。
  const PAD = 0.048;
  const keyBed = box(KW + PAD * 2, 0.024, 0.18, M.ebonySat, 0.004);
  keyBed.position.set(cx, 0.186, 0.060);
  root.add(keyBed);
  const frontRail = box(KW + PAD * 2, 0.050, 0.020, M.ebony, 0.004);
  frontRail.position.set(cx, 0.174, 0.162);
  root.add(frontRail);
  const frontFelt = box(KW, 0.006, 0.010, M.felt, 0.002);
  frontFelt.position.set(cx, 0.198, 0.147);
  root.add(frontFelt);
  const backFelt = box(KW, 0.006, 0.010, M.felt, 0.002);
  backFelt.position.set(cx, 0.198, -0.002);
  root.add(backFelt);
  // 键盖（前挡板）：真琴弹奏时键盖是折回平放的，这里做成一堵矮挡板，
  // 顶面必须低于谱架下沿，否则会和谱架叠成一堵“黑墙”。
  const fallboard = box(KW, 0.10, 0.024, M.ebony, 0.004);
  fallboard.position.set(cx, 0.250, -0.020);
  root.add(fallboard);

  // 谱架：拱顶圆角面板、顶端背离演奏者倾斜、底部托条。
  // 关键约束：顶边必须低于闭合琴盖底面 LID_UNDER_Y，否则关盖时谱架会戳穿琴盖。
  const deskW = KW * 0.62;
  const deskBaseY = 0.275;                       // 谱架下沿（与键井盖板同高，被键盖遮住）
  const deskH = (LID_UNDER_Y - 0.004 - deskBaseY) / Math.cos(0.16) - 0.016; // 面板高度（含拱顶留量）
  const deskShape = new THREE.Shape();
  deskShape.moveTo(-deskW / 2, 0);
  deskShape.lineTo(-deskW / 2, deskH - 0.055);
  deskShape.quadraticCurveTo(-deskW / 2, deskH - 0.014, -deskW / 2 + 0.06, deskH - 0.008);
  deskShape.quadraticCurveTo(0, deskH + 0.016, deskW / 2 - 0.06, deskH - 0.008);
  deskShape.quadraticCurveTo(deskW / 2, deskH - 0.014, deskW / 2, deskH - 0.055);
  deskShape.lineTo(deskW / 2, 0);
  deskShape.closePath();
  const desk = new THREE.Group();
  const deskPanel = new THREE.Mesh(new THREE.ExtrudeGeometry(deskShape, {
    depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 10,
  }), M.ebony);
  deskPanel.castShadow = true; deskPanel.receiveShadow = true;
  const deskLip = box(deskW * 1.06, 0.016, 0.052, M.ebonySat, 0.003);
  deskLip.position.set(0, 0.020, 0.030);
  desk.add(deskPanel, deskLip);
  desk.position.set(cx, deskBaseY, -0.062);
  desk.rotation.x = -0.16;
  root.add(desk);
  // 键盖与谱架之间的暗色键井盖板，遮住音板前缘。
  const keywell = box(deskW * 1.02, 0.030, 0.10, M.ebonySat, 0.004);
  keywell.position.set(cx, 0.315, -0.075);
  root.add(keywell);
  // 谱架两侧的平盖板（键井盖板延伸到 rim 内壁，与真琴的谱架侧板同高同深）。
  const innerL = cx + (outer[0].x - cx) * 0.925;
  const innerR = cx + (outer[1].x - cx) * 0.925;
  for (const [edgeFrom, edgeTo] of [[innerL + 0.012, cx - deskW / 2], [cx + deskW / 2, innerR - 0.012]]) {
    const w = edgeTo - edgeFrom;
    if (w <= 0.02) continue;
    const shoulder = box(w, 0.030, 0.10, M.ebonySat, 0.006);
    shoulder.position.set((edgeFrom + edgeTo) / 2, 0.315, -0.075);
    root.add(shoulder);
  }

  for (const x of [-PAD / 2, KW + PAD / 2]) {
    const cheek = box(PAD, 0.11, 0.18, M.ebony, 0.006);
    cheek.position.set(x, 0.235, 0.058);
    root.add(cheek);
  }

  const keys = new Map();
  const keyMeshes = [];
  const whiteSample = layout.keys.find((k) => !k.isBlack);
  const blackSample = layout.keys.find((k) => k.isBlack);
  const blackGeo = prismGeometry(keyRectShape(blackSample.width, blackSample.length), BLACK_H);
  // 黑键键体：键帽下方延伸一段略窄的键体，嵌在白键之间的键槽里。
  // 只有键帽时，按下后抬起的那一端下方会直接露出白键顶面，像一块悬空方块。
  const blackBodyGeo = prismGeometry(keyRectShape(blackSample.width * 0.95, blackSample.length * 0.97, 0.0012), BLACK_BODY_H);
  // 白键靠键尾的一段要给黑键让位（真琴白键在这里是铣出键槽的）：
  // 键尾边界直接由相邻黑键键体外缘 + 间隙算出（黑键并不在键缝正中，不能用固定让位量）。
  // 有了键槽，黑键键体才落在白键之间，按下时槽内可见键体，而不会露出白键顶面。
  const blackKeys = layout.keys.filter((k) => k.isBlack);
  const blackFrontZ = blackKeys.reduce((m, k) => Math.max(m, 0.002 + k.length), 0);
  const whiteGeoCache = new Map();
  function whiteKeyGeometry(centerX) {
    const halfW = whiteSample.width / 2;
    const halfL = whiteSample.length / 2;
    const halfSlot = blackSample.width / 2 + BLACK_SLOT;   // 黑键半宽 + 单边间隙
    let tailLeft = -halfW;
    let tailRight = halfW;
    for (const b of blackKeys) {
      const dx = b.centerX - centerX;
      if (dx > 0) tailRight = Math.min(tailRight, dx - halfSlot);
      else if (dx < 0) tailLeft = Math.max(tailLeft, dx + halfSlot);
    }
    tailLeft = Math.max(tailLeft, -halfW);
    tailRight = Math.min(tailRight, halfW);
    const cacheKey = `${tailLeft.toFixed(5)}|${tailRight.toFixed(5)}`;
    const cached = whiteGeoCache.get(cacheKey);
    if (cached) return cached;
    // 形状坐标 y = -局部 z：键前端为 -halfL、键尾为 +halfL
    const tailY = -(blackFrontZ + 0.004 - (KEY_BACK_Z + halfL));    // 键尾段的起始 z（覆盖黑键全长）
    const pts = [
      new THREE.Vector2(-halfW, -halfL),                             // 键前端左
      new THREE.Vector2(halfW, -halfL),                              // 键前端右
      new THREE.Vector2(halfW, tailY),                               // 右侧走到键尾段起点
    ];
    if (tailRight < halfW - 1e-6) pts.push(new THREE.Vector2(tailRight, tailY));
    pts.push(new THREE.Vector2(tailRight, halfL));                   // 键尾右
    pts.push(new THREE.Vector2(tailLeft, halfL));                    // 键尾左
    if (tailLeft > -halfW + 1e-6) pts.push(new THREE.Vector2(tailLeft, tailY), new THREE.Vector2(-halfW, tailY));
    const geo = prismGeometry(roundedShape(pts, 0.0022), KEY_H);
    whiteGeoCache.set(cacheKey, geo);
    return geo;
  }
  layout.keys.forEach((k, i) => {
    const isBlack = k.isBlack;
    const backZ = isBlack ? 0.002 : KEY_BACK_Z;
    const frontZ = backZ + k.length;
    const pivotY = KEY_TOP - KEY_H;
    const pivot = new THREE.Group();
    pivot.position.set(k.centerX, pivotY, BALANCE_Z);
    const mat = (isBlack ? M.blackKey : M.whiteKey).clone();
    mat.emissive = new THREE.Color(0x000000);
    const mesh = new THREE.Mesh(isBlack ? blackGeo : whiteKeyGeometry(k.centerX), mat);
    mesh.position.set(0, isBlack ? KEY_H - BLACK_SINK + BLACK_H / 2 : KEY_H / 2,
      (backZ + frontZ) / 2 - BALANCE_Z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.midi = k.midi;
    pivot.add(mesh);
    keyMeshes.push(mesh);
    if (isBlack) {
      const body = new THREE.Mesh(blackBodyGeo, mat);   // 与键帽共用材质，按键高亮一起生效
      body.position.set(0, KEY_H - BLACK_SINK - BLACK_BODY_H / 2, mesh.position.z);
      body.castShadow = true;
      body.userData.midi = k.midi;
      pivot.add(body);
      keyMeshes.push(body);
    }
    root.add(pivot);
    keys.set(k.midi, {
      midi: k.midi, isBlack, pivot, mesh, material: mat,
      length: k.length, backZ, frontZ, centerX: k.centerX,
      topY: isBlack ? KEY_TOP + BLACK_H - BLACK_SINK : KEY_TOP,
      pivotY, pivotZ: BALANCE_Z,
      press: 0, target: 0,
      maxAngle: Math.asin(0.010 / Math.max(0.001, frontZ - BALANCE_Z)),
    });
  });

  // 6) 琴盖：铰链沿琴身左侧直边（spine），绕前后轴侧向开合，与参考图正视图/透视图一致。
  const hingeX = outer[0].x + 0.012;
  const lidPivot = new THREE.Group();
  lidPivot.position.set(hingeX, RIM_TOP + 0.010, 0);
  // 琴盖不再是矩形盒，而是沿琴身翼形轮廓制作的薄板，闭合时完整覆盖琴身。
  const lidLocalPts = outer.map((p) => new THREE.Vector2(p.x - hingeX, p.y));
  const lidGeo = extrudedPlanar(lidLocalPts, 0.026, 0.0025);
  const lid = new THREE.Mesh(lidGeo, M.ebony);
  lid.name = 'lid';
  lid.position.y = -LID_THICK;
  lid.castShadow = true;
  lid.receiveShadow = true;
  lidPivot.add(lid);
  const lc = lidLocalPts.reduce((acc, p) => acc.add(p), new THREE.Vector2())
    .multiplyScalar(1 / lidLocalPts.length);
  const lidEdge = new THREE.Mesh(ringGeometry(
    lidLocalPts,
    lidLocalPts.map((p) => new THREE.Vector2(lc.x + (p.x - lc.x) * 0.975, lc.y + (p.y - lc.y) * 0.975)),
    0.006,
  ), M.ebonySat);
  lidEdge.position.y = -0.006;
  lidPivot.add(lidEdge);
  root.add(lidPivot);
  // 铰链轴：顶面必须低于闭合盖面（LID_PIVOT_Y），否则关盖时铜轴会戳出盖面；
  // 同时又要高于 rim 顶面，开盖后才能在铰链线上看到一圈轴。
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, DEPTH * 0.58, 12), M.brass);
  hinge.rotation.x = Math.PI / 2;
  hinge.position.set(hingeX + 0.010, LID_PIVOT_Y - 0.010, -0.48);
  root.add(hinge);
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 10), M.brass);
  root.add(prop);
  const propBase = new THREE.Vector3(KW * 0.975, RIM_TOP + 0.002, -0.66);
  let lidProgress = 1;
  function updateLid(progress) {
    lidProgress = THREE.MathUtils.clamp(progress, 0, 1);
    // 开度越大，琴盖在水平面的投影越短，露出的内腔越多。
    // 上限受真实尺度约束：撑杆开到 0.75rad 时盖头高度约 1.28m，整体刚好不超 1.8m。
    const angle = lidProgress * 0.75;
    lidPivot.rotation.z = angle;
    prop.visible = lidProgress > 0.05;
    if (prop.visible) {
      // 撑杆顶端顶在琴盖底面，底端立在弯侧 rim 顶面。
      const lx = KW * 0.60;
      const top = new THREE.Vector3(
        hingeX + lx * Math.cos(angle) + 0.026 * Math.sin(angle),
        RIM_TOP + 0.010 + lx * Math.sin(angle) - 0.026 * Math.cos(angle),
        propBase.z,
      );
      prop.position.copy(propBase).add(top).multiplyScalar(0.5);
      prop.scale.set(1, propBase.distanceTo(top), 1);
      prop.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(propBase).normalize());
    }
  }
  updateLid(1);

  // 7) 琴腿、琴架、三踏板和动态连杆。
  // 参考图琴腿：方形锥腿 + 顶部安装块 + 踝块 + 带轮黄铜脚轮。
  [[0.08, -0.02], [KW - 0.08, -0.02], [KW * 0.31, -1.16]].forEach(([x, z]) => {
    const topY = 0.02;
    const ankleTop = FLOOR_Y + 0.115;
    const cap = box(0.115, 0.075, 0.115, M.ebony, 0.010);
    cap.position.set(x, topY - 0.030, z);
    root.add(cap);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.070, 0.042, topY - ankleTop, 4, 1), M.ebony);
    leg.rotation.y = Math.PI / 4;
    leg.position.set(x, (topY + ankleTop) / 2, z);
    leg.castShadow = true;
    root.add(leg);
    const ankle = box(0.068, 0.055, 0.068, M.ebony, 0.008);
    ankle.position.set(x, ankleTop - 0.0225, z);
    root.add(ankle);
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.024, 0.045, 10), M.brass);
    fork.position.set(x, FLOOR_Y + 0.048, z);
    root.add(fork);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.016, 16), M.brass);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, FLOOR_Y + 0.026, z);
    wheel.castShadow = true;
    root.add(wheel);
  });

  // 真琴尺度：键床底面 y=0.174；踏板盒底距地面约 5cm、盒顶约 21cm；踏板面距地面约 10cm。
  const lyreX = cx;
  const lyreZ = 0.072;                 // 琴架压在键床正下方（键床 z ∈ [-0.03, 0.15]）
  const KEYBED_UNDER = 0.174;
  const lyreBoxTop = -0.290;
  const lyreBoxBottom = -0.450;
  const pedalDepth = 0.105;
  const pedalThick = 0.014;
  const pedalPivotY = FLOOR_Y + 0.108 - pedalThick / 2;  // 踏板面 ≈ 离地 10.8cm
  const pedalPivotZ = lyreZ + 0.065;                     // 盒体前脸 = 踏板转轴
  // 琴架柱：从键床底面一直落到踏板盒顶面（旧版柱顶停在 y=-0.02，与键床脱开近 19cm）。
  for (const dx of [-0.054, -0.018, 0.018, 0.054]) {
    const postH = KEYBED_UNDER - lyreBoxTop;
    const post = box(0.020, postH, 0.030, M.ebony, 0.004);
    post.position.set(lyreX + dx, (KEYBED_UNDER + lyreBoxTop) / 2, lyreZ);
    root.add(post);
  }
  const lyreBase = box(0.20, lyreBoxTop - lyreBoxBottom, 0.13, M.ebony, 0.008);
  lyreBase.position.set(lyreX, (lyreBoxTop + lyreBoxBottom) / 2, lyreZ);
  root.add(lyreBase);
  // 后方斜撑杆：盒顶后侧撑到琴身底板下表面。
  for (const dx of [-0.07, 0.07]) {
    root.add(cylinderBetween(
      new THREE.Vector3(lyreX + dx, lyreBoxTop - 0.02, lyreZ - 0.05),
      new THREE.Vector3(lyreX + dx * 1.9, -0.03, lyreZ - 0.24),
      0.013, M.ebonySat, 8,
    ));
  }

  const pedals = [];
  const pedalMeshes = [];
  const pedalGroup = new THREE.Group();
  const pedalWidth = 0.028;
  // 三踏板中心间距 ≈ 66mm，外侧两块前端略向外张（真琴踏板的张角）。
  [-0.033, 0, 0.033].forEach((dx, i) => {
    const pivot = new THREE.Group();
    pivot.position.set(lyreX + dx, pedalPivotY, pedalPivotZ);
    pivot.rotation.y = (i - 1) * 0.12;
    const pedal = box(pedalWidth, pedalThick, pedalDepth, M.brass, 0.004);
    pedal.position.z = pedalDepth / 2;
    pedal.userData.pedalIndex = i;
    pivot.add(pedal);
    pedalGroup.add(pivot);
    pedals.push({ pivot, target: 0, press: 0 });
    pedalMeshes.push(pedal);
  });
  root.add(pedalGroup);

  const rods = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0034, 0.0034, 1, 6), M.brass, 3);
  const rodBase = new THREE.Vector3();
  const rodTip = new THREE.Vector3();
  function refreshRods() {
    pedals.forEach((p, i) => {
      rodTip.set(0, pedalThick / 2, 0.012)          // 下端接踏板根部
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), p.pivot.rotation.x)
        .add(p.pivot.position);
      rodBase.set(rodTip.x, KEYBED_UNDER + 0.012, rodTip.z);  // 上端插入键床底面
      orientInstancedCylinder(rods, i, rodBase, rodTip);
    });
    rods.instanceMatrix.needsUpdate = true;
  }
  refreshRods();
  root.add(rods);

  // 琴凳只作为环境比例参照，不参与钢琴包围盒判断。
  const bench = new THREE.Group();
  bench.name = 'bench';
  const seat = box(0.58, 0.060, 0.35, M.leather, 0.012);
  seat.position.y = 0.47;
  bench.add(seat);
  for (const [x, z] of [[-0.23, -0.12], [0.23, -0.12], [-0.23, 0.12], [0.23, 0.12]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.024, 0.46, 12), M.ebony);
    leg.position.set(x, 0.22, z);
    leg.castShadow = true;
    bench.add(leg);
  }
  bench.position.set(cx, FLOOR_Y, 0.66);
  root.add(bench);

  const bounds = { centerX: cx, width: KW, depth: DEPTH, topY: RIM_TOP, keyTopY: KEY_TOP, floorY: FLOOR_Y };

  function setDamper(midi, lifted) {
    const i = damperIndex.get(midi);
    if (i === undefined) return;
    if (damperDefs[i].lifted === lifted) return;
    damperDefs[i].lifted = lifted;
    refreshDampers();
  }

  function setPedal(index, down) {
    if (!pedals[index]) return;
    pedals[index].target = down ? 1 : 0;
  }

  function update(dt) {
    const keyK = 1 - Math.exp(-dt * 34);
    let changed = false;
    layout.keys.forEach((k, i) => {
      const key = keys.get(k.midi);
      const diff = key.target - key.press;
      if (Math.abs(diff) > 0.0005) {
        key.press += diff * keyK;
        key.pivot.rotation.x = key.press * key.maxAngle;
        const glow = key.press * (key.isBlack ? 0.38 : 0.28);
        key.material.emissive.setRGB(glow * 0.25, glow * 0.42, glow * 0.95);
        changed = true;
      }
      pressArr[i] = key.press;
    });
    if (changed) refreshHammers(pressArr);

    pedals.forEach((p) => {
      const diff = p.target - p.press;
      if (Math.abs(diff) > 0.001) p.press += diff * (1 - Math.exp(-dt * 24));
      p.pivot.rotation.x = p.press * 0.18;
    });
    refreshRods();
  }

  return {
    group: root,
    keys,
    keyMeshes,
    pedalMeshes,
    bounds,
    layout,
    materials: M,
    setDamper,
    setPedal,
    updateLid,
    update,
    // 供 tools/selfcheck.mjs 验证嵌套与开孔几何（只读）
    outlines: { outer, inner, lipInner, soundboardPts, platePts, plateFramePts, plateHoles, stringDefs },
    get lidProgress() { return lidProgress; },
  };
}
