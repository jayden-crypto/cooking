// Post-processing for the 3D view: the scene is drawn into a multisampled HDR target,
// the brightest parts (the screen, step lights, exit signs) are blurred into a soft
// bloom at a fraction of the resolution, and one final pass adds that glow, a vignette
// and fine film grain, then tone-maps to the screen. The grain also hides the colour
// banding that dark cinema gradients otherwise show.
//
// The same pipeline renders the small "compare views" pictures (without bloom), so
// every picture of the room has the same look and the same smooth edges.

import * as THREE from '../vendor/three.module.min.js';

const VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// soft-threshold bright pass, downsampling 2x with a 4-tap box
const BRIGHT = `
precision highp float;
uniform sampler2D tMap;
uniform vec2 texel;
uniform float threshold;
uniform float knee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv + texel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tMap, vUv + texel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tMap, vUv + texel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tMap, vUv + texel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float k = max(soft, br - threshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * k, 1.0);
}`;

// dual-filter (Kawase) blur: cheap and smooth at any size
const DOWN = `
precision highp float;
uniform sampler2D tMap;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tMap, vUv).rgb * 4.0;
  s += texture2D(tMap, vUv - texel).rgb;
  s += texture2D(tMap, vUv + texel).rgb;
  s += texture2D(tMap, vUv + vec2(texel.x, -texel.y)).rgb;
  s += texture2D(tMap, vUv - vec2(texel.x, -texel.y)).rgb;
  gl_FragColor = vec4(s * 0.125, 1.0);
}`;

const UP = `
precision highp float;
uniform sampler2D tMap;
uniform sampler2D tBase;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tMap, vUv + vec2(-texel.x * 2.0, 0.0)).rgb;
  s += texture2D(tMap, vUv + vec2(-texel.x, texel.y)).rgb * 2.0;
  s += texture2D(tMap, vUv + vec2(0.0, texel.y * 2.0)).rgb;
  s += texture2D(tMap, vUv + vec2(texel.x, texel.y)).rgb * 2.0;
  s += texture2D(tMap, vUv + vec2(texel.x * 2.0, 0.0)).rgb;
  s += texture2D(tMap, vUv + vec2(texel.x, -texel.y)).rgb * 2.0;
  s += texture2D(tMap, vUv + vec2(0.0, -texel.y * 2.0)).rgb;
  s += texture2D(tMap, vUv + vec2(-texel.x, -texel.y)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture2D(tBase, vUv).rgb, 1.0);
}`;

const COMPOSITE = `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float bloom;
uniform float exposure;
uniform float grain;
uniform float vignette;
uniform vec2 centre;
uniform float aspect;
uniform float time;
uniform float screenBoost;
varying vec2 vUv;

// the ACES fit three.js uses, so colours match the rest of the app
vec3 rrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 c) {
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= exposure / 0.6;
  c = outM * rrtOdt(inM * c);
  return clamp(c, 0.0, 1.0);
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec4 base = texture2D(tScene, vUv);
  vec3 glow = texture2D(tBloom, vUv).rgb * bloom;
  // vignette around the middle of the part of the view you can see
  vec2 d = (vUv - centre) * vec2(aspect, 1.0);
  float vig = mix(1.0 - vignette, 1.0, smoothstep(1.25, 0.3, length(d)));
  // The room is tone-mapped like film; the picture on the screen (drawn with alpha 0)
  // keeps its own colours, the way a projector shows them. Multisampling blends the
  // two smoothly along the screen's edge.
  float screenPx = clamp(1.0 - base.a, 0.0, 1.0);
  vec3 room = acesFilmic((base.rgb + glow) * vig);
  vec3 picture = clamp((base.rgb / screenBoost + glow * 0.35) * mix(1.0, vig, 0.5), 0.0, 1.0);
  vec3 c = toSrgb(mix(room, picture, screenPx));
  // grain: stronger in the shadows, where banding lives; it moves every frame
  float n = hash(gl_FragCoord.xy + fract(time) * 917.0) - 0.5;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c += n * (grain * (1.0 - lum * 0.7) + 1.5 / 255.0);
  gl_FragColor = vec4(c, 1.0);
}`;

const LEVELS = 5;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    // HDR where the GPU can render to half-float, plain 8-bit (highlights clip) otherwise
    const ext = renderer.extensions;
    this.hdr = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    this.type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    // how much brighter than white the screen is drawn (to feed the glow); 8-bit targets
    // would clip that, so there the picture is drawn at its true level
    this.screenBoost = this.hdr ? 1.3 : 1;
    this.targets = {};
    this.bloomChain = null;
    this.quad = new THREE.Mesh(this.fullscreenTriangle());
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = (frag, uniforms) =>
      new THREE.RawShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.mat = {
      bright: mat(BRIGHT, { tMap: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.9 }, knee: { value: 0.45 } }),
      down: mat(DOWN, { tMap: { value: null }, texel: { value: new THREE.Vector2() } }),
      up: mat(UP, { tMap: { value: null }, tBase: { value: null }, texel: { value: new THREE.Vector2() } }),
      composite: mat(COMPOSITE, {
        tScene: { value: null },
        tBloom: { value: null },
        bloom: { value: 0.5 },
        exposure: { value: 1.05 },
        grain: { value: 0.022 },
        vignette: { value: 0.28 },
        centre: { value: new THREE.Vector2(0.5, 0.5) },
        aspect: { value: 1 },
        time: { value: 0 },
        screenBoost: { value: this.screenBoost },
      }),
    };
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
  }

  fullscreenTriangle() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    return g;
  }

  target(name, w, h) {
    let t = this.targets[name];
    if (t && t.width === w && t.height === h) return t;
    t?.dispose();
    t = new THREE.WebGLRenderTarget(w, h, { type: this.type, samples: 4, depthBuffer: true });
    this.targets[name] = t;
    return t;
  }

  chain(w, h) {
    const c = this.bloomChain;
    if (c && c.w === w && c.h === h) return c;
    if (c) for (const t of [...c.down, ...c.up]) t.dispose();
    const opts = { type: this.type, depthBuffer: false };
    const down = [];
    const up = [];
    let cw = Math.max(1, w >> 1);
    let ch = Math.max(1, h >> 1);
    for (let i = 0; i < LEVELS; i++) {
      down.push(new THREE.WebGLRenderTarget(cw, ch, opts));
      up.push(new THREE.WebGLRenderTarget(cw, ch, opts));
      cw = Math.max(1, cw >> 1);
      ch = Math.max(1, ch >> 1);
    }
    this.bloomChain = { w, h, down, up };
    return this.bloomChain;
  }

  pass(material, out) {
    this.quad.material = material;
    this.renderer.setRenderTarget(out);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  /**
   * Draw `scene` from `camera` into the canvas area `view` (CSS px, from the bottom-left
   * corner; omit for the whole canvas). `opts.bloom` turns the glow on, `opts.centre` is
   * where the vignette is centred (0–1 across the view).
   */
  render(scene, camera, { view = null, target = 'main', bloom = true, centre = null, time = 0 } = {}) {
    const r = this.renderer;
    const pr = r.getPixelRatio();
    const size = r.getSize(new THREE.Vector2());
    const v = view || { x: 0, y: 0, w: size.x, h: size.y };
    const w = Math.max(1, Math.round(v.w * pr));
    const h = Math.max(1, Math.round(v.h * pr));
    const sceneRT = this.target(target, w, h);
    r.setRenderTarget(sceneRT);
    r.render(scene, camera);

    let bloomTex = this.black;
    if (bloom) {
      const c = this.chain(w, h);
      const m = this.mat;
      m.bright.uniforms.tMap.value = sceneRT.texture;
      m.bright.uniforms.texel.value.set(1 / w, 1 / h);
      this.pass(m.bright, c.down[0]);
      for (let i = 1; i < LEVELS; i++) {
        m.down.uniforms.tMap.value = c.down[i - 1].texture;
        m.down.uniforms.texel.value.set(1 / c.down[i - 1].width, 1 / c.down[i - 1].height);
        this.pass(m.down, c.down[i]);
      }
      let src = c.down[LEVELS - 1];
      for (let i = LEVELS - 2; i >= 0; i--) {
        m.up.uniforms.tMap.value = src.texture;
        m.up.uniforms.tBase.value = c.down[i].texture;
        m.up.uniforms.texel.value.set(1 / src.width, 1 / src.height);
        this.pass(m.up, c.up[i]);
        src = c.up[i];
      }
      bloomTex = c.up[0].texture;
    }

    const u = this.mat.composite.uniforms;
    u.tScene.value = sceneRT.texture;
    u.tBloom.value = bloomTex;
    u.bloom.value = bloom ? 0.55 / LEVELS : 0;
    u.aspect.value = v.w / v.h;
    u.time.value = time;
    u.centre.value.set(centre?.x ?? 0.5, centre?.y ?? 0.5);
    r.setRenderTarget(null);
    const scissored = !!view;
    if (scissored) {
      r.setScissorTest(true);
      r.setScissor(v.x, v.y, v.w, v.h);
      r.setViewport(v.x, v.y, v.w, v.h);
    }
    this.quad.material = this.mat.composite;
    r.render(this.quadScene, this.quadCam);
    if (scissored) {
      r.setScissorTest(false);
      r.setViewport(0, 0, size.x, size.y);
    }
  }

  dispose() {
    for (const t of Object.values(this.targets)) t.dispose();
    if (this.bloomChain) for (const t of [...this.bloomChain.down, ...this.bloomChain.up]) t.dispose();
  }
}
