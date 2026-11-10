// The 3D auditorium. Built from the same layout numbers as the seat map and the stats,
// rendered from the eye position of whichever seat you're looking at.

import * as THREE from '../vendor/three.module.min.js';
import { drawScene } from './films.js';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const LOOK_OUT_THE_BACK = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90° about x

/** Phone orientation as a camera rotation (the screen faces you, the camera looks out the back). */
function deviceQuaternion(e) {
  const d = THREE.MathUtils.DEG2RAD;
  const screenAngle = (screen.orientation?.angle ?? window.orientation ?? 0) * d;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((e.beta || 0) * d, (e.alpha || 0) * d, -(e.gamma || 0) * d, 'YXZ'));
  q.multiply(LOOK_OUT_THE_BACK);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -screenAngle));
  return q;
}
const FILM_W = 1024;
const FILM_H = 428;
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---------- geometry helpers ---------- */

/** Box with rounded edges and smooth normals, for cushions and seat backs. */
function roundedBox(w, h, d, r, seg = 4) {
  const n = 2 * seg + 1;
  const geo = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const half = [w / 2, h / 2, d / 2];
  const inner = half.map((v) => Math.max(0, v - r));
  const coord = (v, axis) => {
    const i = Math.round((v + 0.5) * n);
    if (i <= seg) return -inner[axis] - r * Math.sin(((seg - i) / seg) * (Math.PI / 2));
    return inner[axis] + r * Math.sin(((i - seg - 1) / seg) * (Math.PI / 2));
  };
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    p.set(coord(pos.getX(k), 0), coord(pos.getY(k), 1), coord(pos.getZ(k), 2));
    q.set(clamp(p.x, -inner[0], inner[0]), clamp(p.y, -inner[1], inner[1]), clamp(p.z, -inner[2], inner[2]));
    dir.subVectors(p, q);
    const len = dir.length();
    if (len > 1e-6) {
      dir.multiplyScalar(1 / len);
      p.copy(q).addScaledVector(dir, r);
      nor.setXYZ(k, dir.x, dir.y, dir.z);
    }
    pos.setXYZ(k, p.x, p.y, p.z);
  }
  geo.deleteAttribute('uv');
  return geo;
}

function merge(geos) {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    const count = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < count; i++) idx[io++] = i + vo;
    vo += count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function seatGeometry(style) {
  if (style === 'recliner') {
    const cushion = roundedBox(0.66, 0.2, 0.62, 0.08).translate(0, 0.44, -0.02);
    const back = roundedBox(0.7, 0.66, 0.28, 0.12).rotateX(0.22).translate(0, 0.76, 0.36);
    const head = roundedBox(0.5, 0.2, 0.16, 0.08).rotateX(0.22).translate(0, 1.0, 0.44);
    const foot = roundedBox(0.6, 0.34, 0.12, 0.05).translate(0, 0.22, -0.34);
    return merge([cushion, back, head, foot]);
  }
  const cushion = roundedBox(0.5, 0.13, 0.48, 0.055).translate(0, 0.45, 0);
  const back = roundedBox(0.54, 0.66, 0.17, 0.075).rotateX(0.16).translate(0, 0.71, 0.3);
  return merge([cushion, back]);
}

function armGeometry(style) {
  if (style === 'recliner') {
    const rest = roundedBox(0.16, 0.12, 0.72, 0.05).translate(0, 0.6, 0.02);
    const body = roundedBox(0.13, 0.5, 0.66, 0.04).translate(0, 0.3, 0.04);
    return merge([rest, body]);
  }
  const rest = roundedBox(0.075, 0.055, 0.5, 0.025).translate(0, 0.66, 0.02);
  const post = roundedBox(0.055, 0.64, 0.4, 0.02).translate(0, 0.32, 0.06);
  return merge([rest, post]);
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function spillTexture() {
  // soft rectangle of light around the screen, falling off over the black masking
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(14px)';
  ctx.fillStyle = '#fff';
  ctx.fillRect(40, 30, 176, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function exitTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d3b22';
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#5dff9e';
  ctx.font = '700 58px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EXIT', 128, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- the theatre ---------- */

export class Theater {
  constructor(container) {
    this.container = container;
    // Phones get 1.5× at most (2× costs nearly twice the pixels for little gain), and
    // antialiasing only where the pixel ratio is low enough that it shows.
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    this.quality = { pr: dpr, cap: dpr, slow: 0, since: performance.now() };
    this.renderer = new THREE.WebGLRenderer({ antialias: dpr < 1.5, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'theater-canvas';
    container.append(this.canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030202);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 120);
    this.camera.rotation.order = 'YXZ';

    this.film = document.createElement('canvas');
    this.film.width = FILM_W;
    this.film.height = FILM_H;
    this.filmCtx = this.film.getContext('2d');
    this.filmTex = new THREE.CanvasTexture(this.film);
    this.filmTex.colorSpace = THREE.SRGBColorSpace;
    this.filmTex.generateMipmaps = false;
    this.filmTex.minFilter = THREE.LinearFilter;
    this.filmTex.anisotropy = 4;
    this.sampler = document.createElement('canvas');
    this.sampler.width = 3;
    this.sampler.height = 2;
    this.samplerCtx = this.sampler.getContext('2d', { willReadFrequently: true });
    this.sceneName = 'desert';

    this.makeMaterials();
    this.makeLights();

    this.size = { w: 1, h: 1 };
    this.region = null;
    this.look = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, dragging: false };
    this.eye = new THREE.Vector3(0, 3, 14);
    this.target = new THREE.Vector3(0, 3, 0);
    this.flight = null;
    this.people = true;
    this.running = false;
    this.lastFilm = 0;
    this.lastSample = 0;
    this.lightColors = [new THREE.Color(0.6, 0.5, 0.4), new THREE.Color(0.6, 0.5, 0.4), new THREE.Color(0.6, 0.5, 0.4)];

    this.bindLook();
    // iOS drops WebGL contexts under memory pressure; three.js rebuilds on restore, we just
    // pause and tell the page
    this.canvas.addEventListener('webglcontextlost', () => {
      this.lost = true;
      this.pause();
      this.onContextLost?.();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.filmTex.needsUpdate = true;
      if (this.running) this.loop();
      this.onContextRestored?.();
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.frame = this.frame.bind(this);
    this.onVisibility = () => (document.hidden ? this.pause() : this.running && this.loop());
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  makeMaterials() {
    this.mat = {
      velvet: new THREE.MeshPhysicalMaterial({
        color: 0x8c1216,
        roughness: 0.78,
        sheen: 1,
        sheenColor: new THREE.Color(0xff5a46),
        sheenRoughness: 0.32,
      }),
      velvetPremium: new THREE.MeshPhysicalMaterial({
        color: 0x5c0d1c,
        roughness: 0.72,
        sheen: 1,
        sheenColor: new THREE.Color(0xff6a7a),
        sheenRoughness: 0.3,
      }),
      leather: new THREE.MeshPhysicalMaterial({
        color: 0x5a1012,
        roughness: 0.42,
        clearcoat: 0.35,
        clearcoatRoughness: 0.4,
        sheen: 0.4,
        sheenColor: new THREE.Color(0xff7060),
      }),
      arm: new THREE.MeshStandardMaterial({ color: 0x17110f, roughness: 0.55, metalness: 0.1 }),
      carpet: new THREE.MeshStandardMaterial({ color: 0x1a1010, roughness: 1 }),
      riser: new THREE.MeshStandardMaterial({ color: 0x0c0808, roughness: 1, side: THREE.DoubleSide }),
      wall: new THREE.MeshStandardMaterial({ color: 0x15111a, roughness: 0.95 }),
      panel: new THREE.MeshStandardMaterial({ color: 0x221b26, roughness: 0.9 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0x060507, roughness: 1 }),
      mask: new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 1 }),
      curtain: new THREE.MeshPhysicalMaterial({
        color: 0x3e070a,
        roughness: 0.9,
        sheen: 0.45,
        sheenColor: new THREE.Color(0xff4a3a),
        sheenRoughness: 0.6,
        side: THREE.DoubleSide,
      }),
      screen: new THREE.MeshBasicMaterial({ map: this.filmTex, toneMapped: false }),
      head: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
      hair: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
      body: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
      spaceMark: new THREE.MeshBasicMaterial({ color: 0x5a5f6a, transparent: true, opacity: 0.55, depthWrite: false }),
      stepLight: new THREE.MeshBasicMaterial({ color: 0xffb066, toneMapped: false }),
      sconce: new THREE.MeshBasicMaterial({ color: 0xffc58a, toneMapped: false }),
      booth: new THREE.MeshBasicMaterial({ color: 0xfff1dc, toneMapped: false }),
      exit: new THREE.MeshBasicMaterial({ map: exitTexture(), toneMapped: false }),
      glow: new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0xffb070,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.5,
      }),
      spill: new THREE.MeshBasicMaterial({
        map: spillTexture(),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.35,
        toneMapped: false,
      }),
    };
  }

  makeLights() {
    this.scene.add(new THREE.AmbientLight(0x2a1c1c, 0.8));
    this.scene.add(new THREE.HemisphereLight(0x3a3040, 0x120808, 0.6));
    this.fill = new THREE.DirectionalLight(0xffc9a0, 0.55);
    this.scene.add(this.fill, this.fill.target);
    this.screenLights = [0, 1, 2].map(() => {
      const l = new THREE.PointLight(0xffffff, 0, 0, 1.1);
      this.scene.add(l);
      return l;
    });
    this.wallLights = [0, 1].map(() => {
      const l = new THREE.PointLight(0xffa860, 1.4, 9, 1.6);
      this.scene.add(l);
      return l;
    });
  }

  /* ---------- building the room ---------- */

  setShow({ layout, scene, taken }) {
    this.sceneName = scene;
    if (layout !== this.layout) this.build(layout);
    this.setTaken(taken);
    this.drawFilm(performance.now() / 1000, true);
  }

  build(layout) {
    if (this.hall) {
      this.scene.remove(this.hall);
      this.hall.traverse((o) => o.geometry?.dispose());
    }
    this.layout = layout;
    const { screen, rows, seats, room, aud } = layout;
    const hall = new THREE.Group();
    this.hall = hall;
    const m = this.mat;
    const arcCentre = aud.rowArc ?? 24;
    const halfW = room.width / 2;

    // screen, curved towards the audience
    const sGeo = new THREE.PlaneGeometry(screen.width, screen.height, 64, 1);
    if (screen.radius) {
      const p = sGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const a = p.getX(i) / screen.radius;
        p.setXYZ(i, screen.radius * Math.sin(a), p.getY(i), screen.radius * (1 - Math.cos(a)));
      }
      sGeo.computeVertexNormals();
    }
    const screenMesh = new THREE.Mesh(sGeo, m.screen);
    screenMesh.position.set(0, screen.centerY, 0);
    hall.add(screenMesh);
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(screen.width * 1.45, screen.height * 1.9), m.spill);
    spill.position.set(0, screen.centerY, -0.25);
    hall.add(spill);

    // masking wall, floor, ceiling, side and back walls
    const wallH = room.ceiling + 1;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(room.width + 2, wallH), m.mask);
    front.position.set(0, wallH / 2 - 0.5, -0.3);
    hall.add(front);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(room.width + 2, room.backZ + 2), m.ceiling);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, room.ceiling, room.backZ / 2);
    hall.add(ceiling);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(room.backZ + 1, wallH), m.wall);
      wall.rotation.y = -side * (Math.PI / 2);
      wall.position.set(side * halfW, wallH / 2 - 0.5, room.backZ / 2);
      hall.add(wall);
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(room.width + 2, wallH), m.wall);
    back.rotation.y = Math.PI;
    back.position.set(0, wallH / 2 - 0.5, room.backZ);
    hall.add(back);

    // stage floor in front of the first row
    const stageDepth = rows[0].z - aud.rowPitch / 2 + 0.3;
    const stage = new THREE.Mesh(new THREE.PlaneGeometry(room.width, stageDepth + 2), m.carpet);
    stage.rotation.x = -Math.PI / 2;
    stage.position.set(0, 0, stageDepth / 2 - 1.3);
    hall.add(stage);

    // stepped, curved floor: one ring-shaped tread per row, with a riser in front of it
    const floorAt = (z) => {
      let y = 0;
      for (const r of rows) if (z >= r.z - aud.rowPitch / 2) y = r.floorY;
      return y;
    };
    rows.forEach((row, i) => {
      const inner = row.radius - aud.rowPitch / 2;
      const outer = i === rows.length - 1 ? room.backZ + arcCentre + 2 : row.radius + aud.rowPitch / 2;
      const sweep = Math.asin(Math.min(0.98, (halfW + 0.5) / inner)) + 0.02;
      const tread = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64, 1, -Math.PI / 2 - sweep, sweep * 2), m.carpet);
      tread.rotation.x = -Math.PI / 2;
      tread.position.set(0, row.floorY, -arcCentre);
      hall.add(tread);
      const below = i === 0 ? 0 : rows[i - 1].floorY;
      const rise = row.floorY - below;
      if (rise > 0.001) {
        const riser = new THREE.Mesh(new THREE.CylinderGeometry(inner, inner, rise, 64, 1, true, -sweep, sweep * 2), m.riser);
        riser.position.set(0, below + rise / 2, -arcCentre);
        hall.add(riser);
      }
    });

    // seats and armrests, instanced
    const seatGeo = seatGeometry(layout.aud.style);
    const armGeo = armGeometry(layout.aud.style);
    const chairs = seats.filter((s) => s.access !== 'space');
    const standard = chairs.filter((s) => !s.premium);
    const premium = chairs.filter((s) => s.premium);
    const mtx = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const place = (list, material) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(seatGeo, material, list.length);
      list.forEach((s, i) => {
        quat.setFromAxisAngle(up, s.yaw);
        mtx.compose(new THREE.Vector3(s.x, s.floorY, s.z), quat, one);
        mesh.setMatrixAt(i, mtx);
      });
      hall.add(mesh);
    };
    const style = layout.aud.style;
    place(standard, style === 'recliner' ? m.leather : m.velvet);
    place(premium, style === 'recliner' ? m.leather : m.velvetPremium);

    const arms = [];
    const isSpace = (s) => s?.access === 'space';
    for (const row of rows) {
      row.seats.forEach((s, i) => {
        const next = row.seats[i + 1];
        const prev = row.seats[i - 1];
        if (isSpace(s)) return; // a wheelchair space has no chair and no armrests
        if ((!prev || prev.block !== s.block) && !isSpace(prev)) arms.push({ arc: s.arc - aud.seatPitch / 2, row });
        if (next && next.block === s.block) {
          if (!isSpace(next)) arms.push({ arc: (s.arc + next.arc) / 2, row });
        } else arms.push({ arc: s.arc + aud.seatPitch / 2, row });
      });
    }
    // a pale outline on the floor marks each wheelchair space
    for (const s of seats.filter(isSpace)) {
      const mark = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.38, 4, 1), m.spaceMark);
      mark.rotation.set(-Math.PI / 2, 0, Math.PI / 4 + s.yaw);
      mark.scale.set(1.15, 1.3, 1);
      mark.position.set(s.x, s.floorY + 0.006, s.z + 0.12);
      hall.add(mark);
    }
    const armMesh = new THREE.InstancedMesh(armGeo, m.arm, arms.length);
    arms.forEach((a, i) => {
      const yaw = a.arc / a.row.radius;
      quat.setFromAxisAngle(up, yaw);
      const pos = new THREE.Vector3(a.row.radius * Math.sin(yaw), a.row.floorY, -arcCentre + a.row.radius * Math.cos(yaw));
      mtx.compose(pos, quat, one);
      armMesh.setMatrixAt(i, mtx);
    });
    hall.add(armMesh);

    // audience: head, a cap of hair over the top and back, and shoulders (filled in by setTaken)
    const headGeo = new THREE.SphereGeometry(0.1, 20, 14).scale(0.8, 1.12, 0.95);
    const hairGeo = new THREE.SphereGeometry(0.106, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.58)
      .rotateX(0.75)
      .scale(0.82, 1.1, 0.98)
      .translate(0, 0.012, 0.012);
    const bodyGeo = new THREE.CapsuleGeometry(0.15, 0.22, 4, 12).rotateZ(Math.PI / 2).scale(1, 1, 0.7);
    this.heads = new THREE.InstancedMesh(headGeo, m.head, seats.length);
    this.hairs = new THREE.InstancedMesh(hairGeo, m.hair, seats.length);
    this.bodies = new THREE.InstancedMesh(bodyGeo, m.body, seats.length);
    this.audience = [this.heads, this.hairs, this.bodies];
    for (const mesh of this.audience) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      hall.add(mesh);
    }

    // aisle step lights
    const lights = [];
    for (const row of rows) {
      const blocks = [...new Set(row.seats.map((s) => s.block))];
      for (let b = 0; b < blocks.length - 1; b++) {
        const left = row.seats.filter((s) => s.block === blocks[b]).at(-1);
        const right = row.seats.find((s) => s.block === blocks[b + 1]);
        const arc = (left.arc + right.arc) / 2;
        for (const side of [-1, 1]) lights.push({ arc: arc + side * (aud.aisleWidth / 2 - 0.12), row });
      }
    }
    const stepGeo = new THREE.BoxGeometry(0.08, 0.025, 0.04);
    const stepMesh = new THREE.InstancedMesh(stepGeo, m.stepLight, lights.length);
    lights.forEach((l, i) => {
      const rad = l.row.radius - aud.rowPitch / 2 + 0.03;
      const yaw = l.arc / rad;
      quat.setFromAxisAngle(up, yaw);
      mtx.compose(new THREE.Vector3(rad * Math.sin(yaw), l.row.floorY + 0.015, -arcCentre + rad * Math.cos(yaw)), quat, one);
      stepMesh.setMatrixAt(i, mtx);
    });
    hall.add(stepMesh);

    // acoustic panels and sconces down both side walls
    const panelCount = Math.floor(room.backZ / 1.7);
    const panelGeo = new THREE.BoxGeometry(0.08, 1, 1.45);
    const panels = new THREE.InstancedMesh(panelGeo, m.panel, panelCount * 2);
    const sconceGeo = new THREE.BoxGeometry(0.05, 0.45, 0.12);
    const sconces = [];
    let pi = 0;
    for (const side of [-1, 1]) {
      for (let k = 0; k < panelCount; k++) {
        const z = 1.2 + k * 1.7;
        const base = floorAt(z);
        const height = room.ceiling - base - 1.4;
        mtx.compose(new THREE.Vector3(side * (halfW - 0.04), base + 0.9 + height / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, height, 1));
        panels.setMatrixAt(pi++, mtx);
        if (k % 2 === 1 && z > rows[0].z - 1) sconces.push(new THREE.Vector3(side * (halfW - 0.07), base + 2.3, z + 0.85));
      }
    }
    hall.add(panels);
    for (const p of sconces) {
      const s = new THREE.Mesh(sconceGeo, m.sconce);
      s.position.copy(p);
      hall.add(s);
      const g = new THREE.Sprite(m.glow);
      g.position.copy(p);
      g.scale.set(1.3, 1.6, 1);
      hall.add(g);
    }
    const midZ = rows[Math.floor(rows.length / 2)].z;
    this.wallLights[0].position.set(-halfW + 0.6, floorAt(midZ) + 2.4, midZ);
    this.wallLights[1].position.set(halfW - 0.6, floorAt(midZ) + 2.4, midZ);

    // exit signs near the front
    for (const side of [-1, 1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.19), m.exit);
      sign.rotation.y = -side * (Math.PI / 2);
      sign.position.set(side * (halfW - 0.02), 2.7, 1.8);
      hall.add(sign);
    }

    // curtains framing the screen
    const curtainW = halfW - screen.edgeX + 0.2;
    const curtainH = room.ceiling + 0.5;
    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(curtainW, curtainH, 160, 1);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        p.setZ(i, Math.sin((x / 0.5) * Math.PI * 2) * 0.09);
      }
      geo.computeVertexNormals();
      const curtain = new THREE.Mesh(geo, m.curtain);
      curtain.position.set(side * (screen.edgeX + curtainW / 2 - 0.05), curtainH / 2 - 0.5, screen.edgeZ + 0.12);
      hall.add(curtain);
    }

    // projection booth window
    const booth = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), m.booth);
    booth.rotation.y = Math.PI;
    booth.position.set(0, room.ceiling - 0.9, room.backZ - 0.01);
    hall.add(booth);

    // light from behind (the booth and spill from the foyer) so seat backs aren't black
    this.fill.position.set(0, room.ceiling + 4, room.backZ + 8);
    this.fill.target.position.set(0, 0, rows[0].z);
    const spread = screen.width / 3;
    this.screenLights.forEach((l, i) => l.position.set((i - 1) * spread, screen.centerY, screen.edgeZ + 1.2));

    this.scene.add(hall);
  }

  setTaken(taken) {
    if (!this.layout) return;
    this.taken = taken;
    const { seats, style } = this.layout;
    const mtx = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    const hair = [0x0b0908, 0x120d0a, 0x1a120d, 0x24180f, 0x2e2117, 0x4a3b2e, 0x6b5a48, 0x161616, 0x0e0e10, 0x3a1f16];
    const skin = [0xf1d3b8, 0xe4bc9a, 0xd3a37c, 0xb8805a, 0x96603f, 0x6e4530, 0x4a2e22];
    const cloth = [0x0c0b0d, 0x12141c, 0x1a1414, 0x0f1a16, 0x1c1a24, 0x221818, 0x101010];
    let n = 0;
    this.headIndex = new Map();
    for (const s of seats) {
      if (!taken.has(s.id)) continue;
      this.headIndex.set(s.id, n);
      const rand = mulberry(s.id);
      const lean = (rand() - 0.5) * 0.09;
      const scale = 0.9 + rand() * 0.22;
      const tall = (rand() - 0.5) * 0.12;
      const turn = s.yaw + (rand() - 0.5) * 0.4;
      quat.setFromAxisAngle(up, turn);
      const local = new THREE.Vector3(lean, style.eyeHeight + 0.04 + tall, style.eyeBack + 0.05).applyAxisAngle(up, s.yaw);
      const at = new THREE.Vector3(s.x, s.floorY, s.z).add(local);
      mtx.compose(at, quat, new THREE.Vector3(scale, scale, scale));
      this.heads.setMatrixAt(n, mtx);
      this.heads.setColorAt(n, color.setHex(skin[Math.floor(rand() * skin.length)]));
      // some hair is fuller than others; a few people have very little
      const volume = rand() < 0.08 ? 0.3 : 0.95 + rand() * 0.25;
      mtx.compose(at, quat, new THREE.Vector3(scale * (0.95 + volume * 0.08), scale * volume, scale * (0.95 + volume * 0.1)));
      this.hairs.setMatrixAt(n, mtx);
      this.hairs.setColorAt(n, color.setHex(hair[Math.floor(rand() * hair.length)]));
      const shoulders = new THREE.Vector3(lean * 0.5, style.eyeHeight - 0.27 + tall, style.eyeBack + 0.1).applyAxisAngle(up, s.yaw);
      quat.setFromAxisAngle(up, s.yaw);
      mtx.compose(new THREE.Vector3(s.x, s.floorY, s.z).add(shoulders), quat, new THREE.Vector3(scale, scale, scale));
      this.bodies.setMatrixAt(n, mtx);
      this.bodies.setColorAt(n, color.setHex(cloth[Math.floor(rand() * cloth.length)]));
      n++;
    }
    this.headCount = n;
    for (const mesh of this.audience) {
      mesh.count = this.people ? n : 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  setPeople(on) {
    this.people = on;
    if (this.audience) for (const mesh of this.audience) mesh.count = on ? this.headCount : 0;
  }

  /* ---------- camera ---------- */

  /** Look from this seat. The first call flies in from the back of the room. */
  focusSeat(seat, { instant = false, quick = false } = {}) {
    const to = new THREE.Vector3(seat.eye.x, seat.eye.y, seat.eye.z);
    const target = new THREE.Vector3(0, this.layout.screen.centerY, 0);
    if (!this.hasFocus) {
      const { room } = this.layout;
      this.eye.set(0, room.backFloor + 3.2, room.backZ - 0.6);
      this.target.copy(target);
      this.hasFocus = true;
      if (!instant && !reduceMotion()) {
        this.flight = { from: this.eye.clone(), to, start: performance.now(), duration: 1700, lift: 0 };
        return;
      }
    }
    this.target.copy(target);
    if (instant || reduceMotion()) {
      this.eye.copy(to);
      this.flight = null;
      return;
    }
    const dist = this.eye.distanceTo(to);
    this.flight = {
      from: this.eye.clone(),
      to,
      start: performance.now(),
      duration: quick ? 280 : clamp(500 + dist * 70, 500, 1300),
      lift: quick ? Math.min(0.15, dist * 0.05) : Math.min(1.1, 0.25 + dist * 0.07),
    };
    // ease the head back to straight ahead while moving
    this.look.vyaw = -this.look.yaw * 3;
    this.look.vpitch = -this.look.pitch * 3;
  }

  resetFlight() {
    this.hasFocus = false;
  }

  /** The part of the canvas not covered by the sheet, in CSS pixels. `ref` fixes the zoom
   *  so the picture doesn't change size as the sheet moves. */
  setRegion(region, ref = region) {
    this.region = region;
    this.ref = ref;
  }

  updateCamera(now) {
    if (this.flight) {
      const f = this.flight;
      const t = clamp((now - f.start) / f.duration, 0, 1);
      const k = ease(t);
      this.eye.lerpVectors(f.from, f.to, k);
      this.eye.y += Math.sin(Math.PI * k) * f.lift;
      if (t >= 1) this.flight = null;
    }
    const L = this.look;
    const tilt = this.tiltAngles();
    if (!L.dragging && tilt) {
      // follow the phone, smoothed a little to take out sensor jitter
      L.yaw += (tilt.yaw - L.yaw) * 0.35;
      L.pitch += (tilt.pitch - L.pitch) * 0.35;
      L.vyaw = L.vpitch = 0;
    } else if (!L.dragging) {
      // spring back to looking at the middle of the screen
      const dt = 1 / 60;
      for (const [p, v] of [
        ['yaw', 'vyaw'],
        ['pitch', 'vpitch'],
      ]) {
        const acc = -L[p] * 38 - L[v] * 11;
        L[v] += acc * dt;
        L[p] += L[v] * dt;
        if (Math.abs(L[p]) < 1e-4 && Math.abs(L[v]) < 1e-4) L[p] = L[v] = 0;
      }
    }
    const d = new THREE.Vector3().subVectors(this.target, this.eye).normalize();
    const pitch = Math.asin(clamp(d.y, -1, 1));
    const yaw = Math.atan2(-d.x, -d.z);
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(pitch + L.pitch, yaw + L.yaw, 0);
    this.camera.updateMatrixWorld();
    this.applyLens();
  }

  focal() {
    const ref = this.ref || { w: this.size.w, h: this.size.h };
    // about 72° across in portrait; wider screens show a little more around the edges
    const tanW = Math.max(1.45, (1.3 * ref.w) / Math.max(1, ref.h));
    return ref.w / tanW;
  }

  applyLens() {
    const { w, h } = this.size;
    const r = this.region || { x: 0, y: 0, w, h };
    const f = this.focal();
    const px = r.x + r.w / 2;
    const py = r.y + Math.max(r.h * 0.4, Math.min(r.h, 120) * 0.5);
    const near = this.camera.near;
    const cam = this.camera;
    cam.projectionMatrix.makePerspective(
      (-px / f) * near,
      ((w - px) / f) * near,
      (py / f) * near,
      (-(h - py) / f) * near,
      near,
      cam.far,
    );
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  bindLook() {
    const c = this.canvas;
    let last = null;
    let lastTap = 0;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.look.dragging = true;
      this.look.vyaw = this.look.vpitch = 0;
      this.onLook?.();
      const now = performance.now();
      if (now - lastTap < 300) {
        // double tap: look straight at the screen again (and re-centre the tilt)
        this.look.yaw = this.look.pitch = 0;
        this.recenterTilt();
      }
      lastTap = now;
    });
    c.addEventListener('pointermove', (e) => {
      if (!last) return;
      const f = this.focal();
      // the room follows your finger, like turning your head
      this.look.yaw = clamp(this.look.yaw + (e.clientX - last.x) / f, -1.0, 1.0);
      this.look.pitch = clamp(this.look.pitch + (e.clientY - last.y) / f, -0.55, 0.7);
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    const end = () => {
      last = null;
      setTimeout(() => {
        if (!last) this.look.dragging = false;
      }, 650);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  /* ---------- tilt the phone to look around ---------- */

  /** Turn tilt on or off. The way the phone is held when it starts counts as straight ahead. */
  setTilt(on) {
    if (!!on === !!this.tiltOn) return;
    this.tiltOn = !!on;
    this.tiltBase = null;
    this.tiltNow = null;
    this.lastOrientation = 0;
    if (on) {
      this.onOrientation = (e) => {
        if (e.alpha == null && e.beta == null && e.gamma == null) return;
        this.tiltNow = deviceQuaternion(e);
        if (!this.tiltBase) this.tiltBase = this.tiltNow.clone();
        this.lastOrientation = performance.now();
      };
      window.addEventListener('deviceorientation', this.onOrientation);
    } else {
      window.removeEventListener('deviceorientation', this.onOrientation);
    }
  }

  recenterTilt() {
    if (this.tiltNow) this.tiltBase = this.tiltNow.clone();
  }

  /** How far the phone has turned since tilt started, as head yaw and pitch (radians). */
  tiltAngles() {
    if (!this.tiltOn || !this.tiltNow || !this.tiltBase) return null;
    const rel = this.tiltBase.clone().invert().multiply(this.tiltNow);
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(rel);
    return {
      yaw: clamp(Math.atan2(-d.x, -d.z), -1.4, 1.4),
      pitch: clamp(Math.asin(clamp(d.y, -1, 1)), -0.6, 0.8),
    };
  }

  /* ---------- film and lights ---------- */

  drawFilm(t, force) {
    if (!force && t - this.lastFilm < 1 / 30) return;
    this.lastFilm = t;
    drawScene(this.sceneName, this.filmCtx, FILM_W, FILM_H, t);
    this.filmTex.needsUpdate = true;
    if (force || t - this.lastSample > 0.2) {
      this.lastSample = t;
      this.samplerCtx.drawImage(this.film, 0, 0, 3, 2);
      const px = this.samplerCtx.getImageData(0, 0, 3, 2).data;
      this.sampled = [0, 1, 2].map((i) => {
        const a = i * 4;
        const b = (3 + i) * 4;
        return new THREE.Color().setRGB((px[a] + px[b]) / 510, (px[a + 1] + px[b + 1]) / 510, (px[a + 2] + px[b + 2]) / 510, THREE.SRGBColorSpace);
      });
      if (force) this.sampled.forEach((c, i) => this.lightColors[i].copy(c));
    }
  }

  updateLights() {
    if (!this.sampled) return;
    let r = 0;
    let g = 0;
    let b = 0;
    this.screenLights.forEach((l, i) => {
      this.lightColors[i].lerp(this.sampled[i], 0.08);
      const c = this.lightColors[i];
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      l.color.copy(c).multiplyScalar(1 / Math.max(0.05, Math.max(c.r, c.g, c.b)));
      l.intensity = (this.layout ? this.layout.screen.width / 2.2 : 6) * (0.45 + lum * 1.4);
      r += c.r / 3;
      g += c.g / 3;
      b += c.b / 3;
    });
    this.mat.spill.color.setRGB(r, g, b);
  }

  /* ---------- loop ---------- */

  resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.onResize?.(this.size);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  loop() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  pause() {
    cancelAnimationFrame(this.raf);
  }

  stop() {
    this.running = false;
    this.pause();
  }

  frame(nowMs) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    this.adapt(nowMs);
    this.render(nowMs);
    if (!this.firstFrameDone) {
      this.firstFrameDone = true;
      this.onFirstFrame?.();
    }
  }

  /** Drop the pixel ratio a notch when frames keep running slow (and never raise it
   *  again: a steady picture beats one that flickers between qualities). */
  adapt(nowMs) {
    const q = this.quality;
    const dt = nowMs - (this.lastFrameAt || nowMs);
    this.lastFrameAt = nowMs;
    if (dt <= 0 || dt > 500 || nowMs - q.since < 2500 || q.pr <= 1) return; // settling, or tab was away
    q.slow = dt > 34 ? q.slow + 1 : Math.max(0, q.slow - 1);
    if (q.slow < 40) return;
    q.pr = Math.max(1, q.pr - 0.25);
    q.slow = 0;
    q.since = nowMs;
    this.renderer.setPixelRatio(q.pr);
    this.renderer.setSize(this.size.w, this.size.h, false);
  }

  render(nowMs = performance.now()) {
    if (!this.layout) return;
    this.onFrame?.();
    this.drawFilm(nowMs / 1000);
    this.updateLights();
    this.renderViews();
    this.updateCamera(nowMs);
    this.renderer.render(this.scene, this.camera);
  }

  /* ---------- small views from other seats ---------- */

  /** jobs: [{ seat, canvas, done }]. Each canvas gets the view from that seat, drawn a few
   *  per frame so the main view keeps running. */
  queueViews(jobs) {
    this.viewQueue = jobs.slice();
  }

  clearViews() {
    this.viewQueue = [];
  }

  renderViews(budgetMs = 12) {
    if (!this.viewQueue?.length) return;
    const r = this.renderer;
    const pr = r.getPixelRatio();
    if (!this.viewCam) {
      this.viewCam = new THREE.PerspectiveCamera(60, 1, 0.05, 120);
      this.viewCam.rotation.order = 'YXZ';
    }
    const cam = this.viewCam;
    const near = cam.near;
    const start = performance.now();
    const target = new THREE.Vector3();
    r.setScissorTest(true);
    let drawn = 0;
    while (this.viewQueue.length && (drawn === 0 || performance.now() - start < budgetMs)) {
      const job = this.viewQueue.shift();
      const out = job.canvas;
      if (!out.isConnected || !out.width) continue;
      // render into the bottom-left corner of the canvas, copy it out, and the full
      // frame drawn straight after covers it before anything reaches the screen
      const w = out.width / pr;
      const h = out.height / pr;
      if (out.width > this.canvas.width || out.height > this.canvas.height) continue;
      const eye = job.seat.eye;
      cam.position.set(eye.x, eye.y, eye.z);
      target.set(0, this.layout.screen.centerY, 0).sub(cam.position).normalize();
      cam.rotation.set(Math.asin(target.y), Math.atan2(-target.x, -target.z), 0);
      cam.updateMatrixWorld();
      const f = w / 1.6; // about 77° across, the same for every seat so they compare fairly
      const px = w / 2;
      const py = h * 0.42;
      cam.projectionMatrix.makePerspective((-px / f) * near, ((w - px) / f) * near, (py / f) * near, (-(h - py) / f) * near, near, cam.far);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      r.setViewport(0, 0, w, h);
      r.setScissor(0, 0, w, h);
      // for a sold seat, take its owner out of the picture while we sit there
      const hide = job.hide && this.people ? this.headIndex?.get(job.seat.id) : undefined;
      const saved = [];
      if (hide !== undefined) {
        for (const mesh of this.audience) {
          const m = new THREE.Matrix4();
          mesh.getMatrixAt(hide, m);
          saved.push(m);
          mesh.setMatrixAt(hide, ZERO);
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
      r.render(this.scene, cam);
      if (hide !== undefined) {
        this.audience.forEach((mesh, k) => {
          mesh.setMatrixAt(hide, saved[k]);
          mesh.instanceMatrix.needsUpdate = true;
        });
      }
      out.getContext('2d').drawImage(this.canvas, 0, this.canvas.height - out.height, out.width, out.height, 0, 0, out.width, out.height);
      job.done?.();
      drawn++;
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.w, this.size.h);
  }

  /** JPEG of the view from the current seat, looking straight at the screen. */
  snapshot(width = 720) {
    const saved = { ...this.look };
    const flight = this.flight;
    if (flight) this.eye.copy(flight.to);
    this.flight = null;
    this.look.yaw = this.look.pitch = 0;
    this.updateCamera(performance.now());
    this.renderer.render(this.scene, this.camera);
    const r = this.region || { x: 0, y: 0, w: this.size.w, h: this.size.h };
    const ratio = this.canvas.width / this.size.w;
    // landscape crop with the screen in the upper part and the rows in front below it
    const cropH = Math.min(r.h, r.w * 0.75);
    const py = r.y + Math.max(r.h * 0.4, Math.min(r.h, 120) * 0.5);
    const top = clamp(py - cropH * 0.4, r.y, r.y + r.h - cropH);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = Math.round((width * cropH) / r.w);
    out.getContext('2d').drawImage(this.canvas, r.x * ratio, top * ratio, r.w * ratio, cropH * ratio, 0, 0, out.width, out.height);
    Object.assign(this.look, saved);
    this.updateCamera(performance.now());
    this.renderer.render(this.scene, this.camera);
    return out.toDataURL('image/jpeg', 0.82);
  }
}

function mulberry(str) {
  let a = 0;
  for (let i = 0; i < str.length; i++) a = (Math.imul(a ^ str.charCodeAt(i), 2654435761) + i) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
