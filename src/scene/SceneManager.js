/**
 * SceneManager — 渲染器 / 相机 / 灯光 / 环境 / 视角预设
 * 采用 PBR + 室内环境贴图(PMREM) + 三点布光，营造真实的漆面反射与柔和阴影。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xebecef);
    this.scene.fog = new THREE.Fog(0xebecef, 8, 26);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.02, 60);
    this.camera.position.set(1.5, 1.35, 1.9);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI * 0.495;   // 不允许穿到地面之下
    this.controls.target.set(0.56, 0.24, -0.5);

    this._setupEnvironment();
    this._setupLights();
    this._setupFloor();
    this._setupAtmosphere();

    this._transition = null;
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  _setupEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = envRT.texture;
    this.envMap = envRT.texture;
    pmrem.dispose();
  }

  _setupLights() {
    // 影棚环境光：柔和的天地光，避免暗部死黑
    const hemi = new THREE.HemisphereLight(0xffffff, 0xc3c7d0, 1.15);
    this.scene.add(hemi);

    // 主光：右上前方，投射主阴影
    const key = new THREE.DirectionalLight(0xfff4e8, 2.3);
    key.position.set(2.0, 3.0, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 9;
    key.shadow.camera.left = -2.4;
    key.shadow.camera.right = 2.4;
    key.shadow.camera.top = 2.4;
    key.shadow.camera.bottom = -2.4;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.018;
    this.scene.add(key);
    this.keyLight = key;

    // 补光：左侧冷光，勾勒琴身轮廓
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.8);
    fill.position.set(-3.0, 1.6, 1.1);
    this.scene.add(fill);

    // 轮廓光：后方暖光
    const rim = new THREE.DirectionalLight(0xffe9cd, 0.95);
    rim.position.set(0.5, 1.7, -3.6);
    this.scene.add(rim);

    // 键盘区域局部补光
    const spot = new THREE.SpotLight(0xffffff, 7, 3.6, 0.9, 0.7, 1.6);
    spot.position.set(0.56, 1.35, 0.65);
    spot.target.position.set(0.56, 0.21, 0.05);
    spot.castShadow = false;
    this.scene.add(spot, spot.target);
    this.spot = spot;
  }

  _setupAtmosphere() {
    // 轻量级影棚尘埃：给静态背景增加空间层次，同时避免遮挡琴键。
    const count = 150;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = -1.5 + Math.random() * 3.2;
      positions[i * 3 + 1] = 0.12 + Math.random() * 2.65;
      positions[i * 3 + 2] = -2.3 + Math.random() * 3.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xfff4df, size: 0.009, sizeAttenuation: true,
      transparent: true, opacity: 0.16, depthWrite: false,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    this._dustClock = 0;

    // 暖色低位反弹光 + 顶部冷光，增强漆面反射与琴下空间感。
    const warm = new THREE.RectAreaLight(0xffd7aa, 1.8, 2.2, 1.1);
    warm.position.set(0.55, 0.10, 1.05);
    warm.rotation.x = -Math.PI / 2;
    this.scene.add(warm);
    const cool = new THREE.RectAreaLight(0xcad9ff, 2.0, 2.8, 1.4);
    cool.position.set(0.4, 2.7, -0.8);
    cool.rotation.x = Math.PI / 2;
    this.scene.add(cool);
  }

  _setupFloor() {
    // 大面积暖灰地面
    const geo = new THREE.CircleGeometry(10, 64);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd6d9de, roughness: 0.72, metalness: 0.03,
    });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floor = floor;

    // 琴下圆形地毯（深酒红，衬托黑色钢琴）
    const rugGeo = new THREE.CircleGeometry(1.55, 64);
    const rugMat = new THREE.MeshStandardMaterial({
      color: 0x5e1f24, roughness: 0.95, metalness: 0.0,
    });
    const rug = new THREE.Mesh(rugGeo, rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.002;
    rug.receiveShadow = true;
    this.scene.add(rug);
    this.rug = rug;
  }

  /** 由钢琴模型决定地面高度，保证二者严格一致 */
  setFloorY(y) {
    this.floor.position.y = y;
    if (this.rug) this.rug.position.y = y + 0.002;
    this.spot.target.position.y = y + 0.73;
    this.spot.target.updateMatrixWorld();
    const k = this.keyLight.shadow.camera;
    k.bottom = y - 0.2;
    k.updateProjectionMatrix();
  }

  add(obj) { this.scene.add(obj); }

  /** 根据钢琴包围盒生成视角预设 */
  presets(b) {
    const cx = b.centerX, ky = b.keyTopY, ty = b.topY, kw = b.width;
    return {
      hero: {
        // 全貌：从琴身右前方高位俯瞰。开起的顶盖铰链在左侧 spine、向高音侧抬起，
        // 相机偏右才能从琴盖抬缘下方看进去（射线采样：内构可见面 35% → 54%），
        // 同时保留翼形琴身 + 琴弦/铸铁框 + 键盘。
        pos: [cx + 0.55, 1.85, 1.95], target: [cx - 0.02, 0.30, -0.80], fov: 40,
        label: '全貌',
      },
      player: {
        // 坐在琴前：略偏上、居中、面向键面。看键与琴身轮廓二者皆宜
        pos: [cx, ky + 0.42, 0.72], target: [cx, ky - 0.018, 0.02], fov: 46,
        label: '演奏视角',
      },
      keys: {
        // 键面特写：高俯视，便于看键顶 + 键标签
        pos: [cx, ky + 0.36, 0.40], target: [cx, ky + 0.015, 0.05], fov: 44,
        label: '键面特写',
      },
      full: {
        pos: [cx + 1.75, 1.55, 2.15], target: [cx, ty - 0.06, -b.depth * 0.45], fov: 42,
        label: '全景',
      },
      top: {
        // 内腔俯视：琴盖铰链在 spine 直边、向高音侧抬起，像一个斜搭在琴身上的坡面，
        // 正俯视会被整片盖住。相机移到高音侧斜上方（琴盖抬缘之外），
        // 视线从抬缘下方穿入，即可看到弦床 / 铁板开窗 / 音板 / 琴码 / 击弦机。
        pos: [cx + kw * 0.95, 2.30, 0.85], target: [cx - 0.05, 0.40, -0.72], fov: 44,
        label: '内腔俯视',
      },
      side: {
        pos: [cx - 2.3, 0.78, 0.15], target: [cx, ty - 0.04, -b.depth * 0.35], fov: 45,
        label: '侧视',
      },
    };
  }

  setView(name, bounds, instant = false) {
    const p = this.presets(bounds)[name];
    if (!p) return;
    if (instant) {
      this.camera.position.set(...p.pos);
      this.controls.target.set(...p.target);
      this.camera.fov = p.fov;
      this.camera.updateProjectionMatrix();
      this._transition = null;
      return;
    }
    this._transition = {
      t: 0,
      fromPos: this.camera.position.clone(),
      toPos: new THREE.Vector3(...p.pos),
      fromTarget: this.controls.target.clone(),
      toTarget: new THREE.Vector3(...p.target),
      fromFov: this.camera.fov, toFov: p.fov,
    };
  }

  update(dt) {
    if (this.dust) {
      this._dustClock += dt;
      const pos = this.dust.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i) + dt * (0.004 + (i % 5) * 0.001);
        pos.setY(i, y > 2.85 ? 0.12 : y);
        pos.setX(i, x + Math.sin(this._dustClock * 0.35 + i) * dt * 0.0015);
      }
      pos.needsUpdate = true;
    }
    if (this._transition) {
      const tr = this._transition;
      tr.t = Math.min(1, tr.t + dt / 0.85);
      const e = tr.t < 0.5 ? 4 * tr.t ** 3 : 1 - Math.pow(-2 * tr.t + 2, 3) / 2;  // easeInOutCubic
      this.camera.position.lerpVectors(tr.fromPos, tr.toPos, e);
      this.controls.target.lerpVectors(tr.fromTarget, tr.toTarget, e);
      this.camera.fov = tr.fromFov + (tr.toFov - tr.fromFov) * e;
      this.camera.updateProjectionMatrix();
      if (tr.t >= 1) this._transition = null;
    }
    this.controls.update();
  }

  render() { this.renderer.render(this.scene, this.camera); }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
}
