// The "films": little animated scenes drawn on a 2D canvas. The 3D screen uses them as a
// live texture and the home page uses stills of them as posters. Each one is a pure
// function of (ctx, width, height, seconds) so any frame can be drawn at any size.

import { rng } from './data.js';

/* ---------- helpers ---------- */

function valueNoise(seed) {
  const rand = rng(seed);
  const table = Array.from({ length: 256 }, rand);
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[i & 255];
    const b = table[(i + 1) & 255];
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  };
}

function fbm(noise, x, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq + o * 17.3);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function vGradient(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([at, color]) => g.addColorStop(at, color));
  return g;
}

function glow(ctx, x, y, r, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  // fade to the same colour at zero alpha; fading to transparent black turns it grey
  g.addColorStop(1, color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgba($1,$2,$3,0)'));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.globalAlpha = 1;
}

function stars(ctx, w, h, t, seed, count, maxY = 1) {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h * maxY;
    const size = rand() < 0.08 ? 1.6 : 0.9;
    const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + rand() * 2) + i);
    ctx.globalAlpha = (0.35 + rand() * 0.65) * tw;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, size * (w / 1024) * 1.4, size * (w / 1024) * 1.4);
  }
  ctx.globalAlpha = 1;
}

function vignette(ctx, w, h, strength = 0.55) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* ---------- scenes ---------- */

const duneNoise = [valueNoise('dune-a'), valueNoise('dune-b'), valueNoise('dune-c'), valueNoise('dune-d')];

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const rgb = (c, alpha = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;

function desert(ctx, w, h, t) {
  ctx.fillStyle = vGradient(ctx, 0, h * 0.62, [
    [0, '#bcab9a'],
    [0.65, '#dcc9b4'],
    [1, '#ecdcc8'],
  ]);
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.72, h * 0.4, w * 0.45, 'rgba(255,246,232,0.8)');

  // Far to near. The sun is on the right, so the left face of every crest is in shade.
  const layers = [
    { base: 0.62, amp: 0.1, freq: 2.2, lit: [228, 210, 184], shade: [205, 182, 154], speed: 0.003 },
    { base: 0.72, amp: 0.16, freq: 1.5, lit: [226, 196, 156], shade: [184, 146, 108], speed: 0.006 },
    { base: 0.86, amp: 0.22, freq: 1.05, lit: [218, 176, 124], shade: [150, 106, 70], speed: 0.01 },
    { base: 1.06, amp: 0.3, freq: 0.75, lit: [204, 154, 100], shade: [104, 68, 42], speed: 0.015 },
  ];
  const step = Math.max(2, Math.round(w / 320));
  const s = h / 428;
  let walkerYs = null;
  layers.forEach((L, li) => {
    const noise = duneNoise[li];
    const xs = [];
    const ys = [];
    for (let x = -step * 2; x <= w + step * 2; x += step) {
      const u = (x / w) * L.freq + t * L.speed + li * 10;
      const ridge = 1 - Math.abs(fbm(noise, u, 2) * 2 - 1); // sharp crests
      xs.push(x);
      ys.push(h * (L.base - L.amp * Math.pow(ridge, 1.3)));
    }
    const top = Math.min(...ys);
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(xs[0], h);
      ys.forEach((y, i) => ctx.lineTo(xs[i], y));
      ctx.lineTo(xs[xs.length - 1], h);
      ctx.closePath();
    };
    body();
    ctx.fillStyle = vGradient(ctx, top, h, [
      [0, rgb(L.lit)],
      [1, rgb(mix(L.lit, L.shade, 0.55))],
    ]);
    ctx.fill();

    ctx.save();
    body();
    ctx.clip();
    // lee faces: from each crest back down the slope to the left, with a curved edge
    // sweeping down and to the right, like wind-cut sand
    let trough = 0;
    for (let i = 1; i < ys.length - 1; i++) {
      if (ys[i] >= ys[i - 1] && ys[i] > ys[i + 1]) trough = i;
      const isPeak = ys[i] < ys[i - 1] && ys[i] <= ys[i + 1];
      if (!isPeak || i - trough < 2) continue;
      const px = xs[i];
      const py = ys[i];
      const reach = (px - xs[trough]) * 0.5 + 30 * s;
      const tx = xs[trough];
      const ty = ys[trough];
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let k = i - 1; k >= trough; k--) ctx.lineTo(xs[k], ys[k]);
      ctx.quadraticCurveTo(tx - (px - tx) * 0.05, ty + (h - ty) * 0.5, tx - (px - tx) * 0.3, h);
      ctx.lineTo(px + reach, h);
      ctx.bezierCurveTo(px + reach * 0.35, py + (h - py) * 0.55, px + reach * 0.05, py + (h - py) * 0.15, px, py);
      ctx.closePath();
      ctx.fillStyle = vGradient(ctx, py, h, [
        [0, rgb(L.shade, 0.95)],
        [1, rgb(L.shade, 0.55)],
      ]);
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,244,228,0.35)';
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ys.forEach((y, i) => (i ? ctx.lineTo(xs[i], y) : ctx.moveTo(xs[i], y)));
    ctx.stroke();
    if (li === 1) walkerYs = ys;
  });

  // a lone traveller walking along a far ridge
  const wx = ((0.36 + t * 0.006) % 1.2) * w;
  const idx = Math.max(0, Math.min(walkerYs.length - 1, Math.round(wx / step) + 2));
  const wy = walkerYs[idx];
  ctx.fillStyle = '#2e2218';
  ctx.beginPath();
  ctx.ellipse(wx, wy - 8 * s, 1.6 * s, 5.5 * s, 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(wx + 0.3 * s, wy - 15 * s, 1.5 * s, 0, Math.PI * 2);
  ctx.fill();

  // blowing sand
  const rand = rng('sand');
  ctx.fillStyle = 'rgba(255,245,230,0.45)';
  for (let i = 0; i < 70; i++) {
    const x = (rand() * w + t * (40 + rand() * 60) * s) % w;
    const y = h * (0.55 + rand() * 0.45);
    ctx.fillRect(x, y, 2 * s, 0.8 * s);
  }
  vignette(ctx, w, h, 0.32);
}

const waveNoise = valueNoise('waves');

function ocean(ctx, w, h, t) {
  const horizon = h * 0.6;
  ctx.fillStyle = vGradient(ctx, 0, horizon, [
    [0, '#141532'],
    [0.45, '#4a2f5c'],
    [0.8, '#c8656b'],
    [1, '#f4a46e'],
  ]);
  ctx.fillRect(0, 0, w, horizon);
  stars(ctx, w, h, t, 'ocean-stars', 60, 0.3);

  const sx = w * 0.56;
  const sy = horizon - h * 0.02;
  glow(ctx, sx, sy, h * 0.7, 'rgba(255,170,110,0.55)');
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, horizon);
  ctx.clip();
  ctx.fillStyle = '#ffd9a0';
  ctx.beginPath();
  ctx.arc(sx, sy, h * 0.085, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // thin clouds
  ctx.fillStyle = 'rgba(40,24,52,0.55)';
  for (let i = 0; i < 4; i++) {
    const cy = horizon * (0.55 + i * 0.09);
    const cx = ((i * 0.37 + t * 0.003 * (i + 1)) % 1.4) * w - w * 0.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * (0.18 + i * 0.03), h * 0.008, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = vGradient(ctx, horizon, h, [
    [0, '#3b2a4a'],
    [1, '#0b0a18'],
  ]);
  ctx.fillRect(0, horizon, w, h - horizon);

  // sun path shimmering on the water
  const lines = 46;
  for (let i = 0; i < lines; i++) {
    const p = i / lines;
    const y = horizon + 2 + p * p * (h - horizon);
    const spread = w * (0.03 + p * 0.16);
    const wob = Math.sin(t * 2 + i * 1.7) * spread * 0.25;
    const len = spread * (0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + i * 2.1)));
    ctx.globalAlpha = 0.65 * (1 - p * 0.75);
    ctx.fillStyle = '#ffc88a';
    ctx.fillRect(sx - len / 2 + wob, y, len, 1 + p * 2.5);
  }
  ctx.globalAlpha = 1;
  // wave lines
  ctx.strokeStyle = 'rgba(255,190,150,0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const p = (i + 1) / 15;
    const y = horizon + p * p * (h - horizon);
    ctx.beginPath();
    for (let x = 0; x <= w; x += 16) {
      const yy = y + Math.sin(x * 0.02 / (p + 0.2) + t * (0.6 + p) + i) * (1 + p * 4) + (waveNoise(x * 0.01 + i * 5) - 0.5) * p * 6;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  // headland and lighthouse
  const s = h / 428;
  ctx.fillStyle = '#0a0812';
  ctx.beginPath();
  ctx.moveTo(0, horizon + 30 * s);
  ctx.bezierCurveTo(w * 0.08, horizon - 18 * s, w * 0.16, horizon - 26 * s, w * 0.24, horizon + 6 * s);
  ctx.lineTo(w * 0.3, horizon + 34 * s);
  ctx.lineTo(0, horizon + 60 * s);
  ctx.closePath();
  ctx.fill();
  const lx = w * 0.15;
  const ly = horizon - 22 * s;
  ctx.beginPath();
  ctx.moveTo(lx - 7 * s, ly);
  ctx.lineTo(lx - 4 * s, ly - 62 * s);
  ctx.lineTo(lx + 4 * s, ly - 62 * s);
  ctx.lineTo(lx + 7 * s, ly);
  ctx.fill();
  ctx.fillRect(lx - 6 * s, ly - 72 * s, 12 * s, 10 * s);
  // rotating beam
  const a = t * 0.9;
  const facing = Math.cos(a);
  const beamLen = w * 0.55;
  const dir = Math.sin(a) >= 0 ? 1 : -1;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const bg = ctx.createLinearGradient(lx, 0, lx + dir * beamLen, 0);
  bg.addColorStop(0, `rgba(255,235,190,${0.55 * Math.abs(facing) + 0.15})`);
  bg.addColorStop(1, 'rgba(255,235,190,0)');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(lx, ly - 67 * s);
  ctx.lineTo(lx + dir * beamLen, ly - 67 * s - (14 + 40 * (1 - Math.abs(facing))) * s);
  ctx.lineTo(lx + dir * beamLen, ly - 67 * s + (14 + 40 * (1 - Math.abs(facing))) * s);
  ctx.closePath();
  ctx.fill();
  glow(ctx, lx, ly - 67 * s, 26 * s * (1 + Math.abs(facing)), 'rgba(255,240,200,0.9)');
  ctx.restore();
  vignette(ctx, w, h, 0.45);
}

function buildings(seed, count, minH, maxH) {
  const rand = rng(seed);
  const list = [];
  let x = -0.02;
  while (x < 1.02 && list.length < count) {
    const bw = 0.03 + rand() * 0.06;
    list.push({ x, w: bw, h: minH + rand() * (maxH - minH), seed: rand(), antenna: rand() < 0.2 });
    x += bw + rand() * 0.008;
  }
  return list;
}
const CITY = [buildings('city-far', 60, 0.22, 0.5), buildings('city-mid', 60, 0.3, 0.62), buildings('city-near', 60, 0.18, 0.5)];

function city(ctx, w, h, t) {
  ctx.fillStyle = vGradient(ctx, 0, h, [
    [0, '#05060f'],
    [0.6, '#1b1236'],
    [1, '#3a1840'],
  ]);
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.5, h * 0.95, w * 0.6, 'rgba(255,80,140,0.25)');
  const ground = h * 0.86;
  const tints = ['#1c1a3c', '#120f26', '#07060f'];
  CITY.forEach((list, li) => {
    for (const b of list) {
      const bx = b.x * w;
      const bw = b.w * w;
      const top = ground - b.h * h * (0.75 + li * 0.15);
      ctx.fillStyle = tints[li];
      ctx.fillRect(bx, top, bw, ground - top);
      if (b.antenna) ctx.fillRect(bx + bw / 2 - 1, top - h * 0.05, 2, h * 0.05);
      // windows
      const rand = rng(b.seed * 1e9);
      const cell = (li + 1) * (w / 320);
      for (let wy = top + cell * 2; wy < ground - cell; wy += cell * 2.2) {
        for (let wx = bx + cell; wx < bx + bw - cell; wx += cell * 1.8) {
          const r = rand();
          const on = r < 0.28 + li * 0.05 && Math.sin(t * 0.3 + r * 50) > -0.9;
          if (!on) continue;
          ctx.fillStyle = r < 0.12 ? 'rgba(140,200,255,0.75)' : 'rgba(255,205,140,0.8)';
          ctx.globalAlpha = 0.4 + li * 0.25;
          ctx.fillRect(wx, wy, cell, cell * 0.9);
        }
      }
      ctx.globalAlpha = 1;
    }
  });
  // neon signs on the near buildings
  const signs = [
    [0.18, 0.5, '#ff3d8b'],
    [0.47, 0.42, '#36e7ff'],
    [0.78, 0.55, '#ffb43d'],
  ];
  ctx.save();
  signs.forEach(([sx, sy, color], i) => {
    const flicker = Math.sin(t * 13 + i * 7) > 0.97 ? 0.25 : 1;
    ctx.globalAlpha = flicker;
    ctx.shadowColor = color;
    ctx.shadowBlur = h * 0.05;
    ctx.fillStyle = color;
    ctx.fillRect(sx * w, sy * h, w * 0.012, h * 0.22);
    ctx.fillRect(sx * w + w * 0.02, sy * h + h * 0.05, w * 0.05, h * 0.012);
  });
  ctx.restore();
  // wet street with reflections
  ctx.fillStyle = vGradient(ctx, ground, h, [
    [0, '#120a1c'],
    [1, '#05040a'],
  ]);
  ctx.fillRect(0, ground, w, h - ground);
  signs.forEach(([sx, , color], i) => {
    ctx.globalAlpha = 0.35 + 0.1 * Math.sin(t * 2 + i);
    ctx.fillStyle = color;
    for (let k = 0; k < 6; k++) {
      ctx.fillRect(sx * w - k * 2 + Math.sin(t * 3 + k) * 3, ground + k * (h - ground) / 6, w * 0.014, (h - ground) / 10);
    }
  });
  ctx.globalAlpha = 1;
  // rain
  const rand = rng('rain');
  ctx.strokeStyle = 'rgba(190,200,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 160; i++) {
    const speed = 0.6 + rand() * 0.6;
    const x = (rand() * w * 1.2 + t * 60 * speed) % (w * 1.2) - w * 0.1;
    const y = (rand() * h + t * h * 1.6 * speed) % h;
    ctx.moveTo(x, y);
    ctx.lineTo(x - h * 0.012, y + h * 0.05);
  }
  ctx.stroke();
  vignette(ctx, w, h, 0.55);
}

const ridgeNoise = [valueNoise('peaks-a'), valueNoise('peaks-b')];
let auroraSprite = null;
function getAuroraSprite() {
  if (auroraSprite) return auroraSprite;
  auroraSprite = document.createElement('canvas');
  auroraSprite.width = 4;
  auroraSprite.height = 256;
  const c = auroraSprite.getContext('2d');
  const g = c.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, 'rgba(120,255,190,0)');
  g.addColorStop(0.08, 'rgba(120,255,190,0.95)');
  g.addColorStop(0.45, 'rgba(70,220,170,0.45)');
  g.addColorStop(0.8, 'rgba(150,90,255,0.25)');
  g.addColorStop(1, 'rgba(150,90,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 4, 256);
  return auroraSprite;
}

function aurora(ctx, w, h, t) {
  ctx.fillStyle = vGradient(ctx, 0, h, [
    [0, '#020512'],
    [0.7, '#0a1a33'],
    [1, '#10284a'],
  ]);
  ctx.fillRect(0, 0, w, h);
  stars(ctx, w, h, t, 'aurora-stars', 180, 0.75);

  const sprite = getAuroraSprite();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let band = 0; band < 3; band++) {
    const stepX = Math.max(2, w / 300);
    for (let x = 0; x < w; x += stepX) {
      const u = x / w;
      const base = h * (0.36 + band * 0.07 + 0.08 * Math.sin(u * 4 + t * 0.15 + band * 2) + 0.03 * Math.sin(u * 13 - t * 0.4));
      const tall = h * (0.18 + 0.14 * (0.5 + 0.5 * Math.sin(u * 9 + t * 0.5 + band)));
      ctx.globalAlpha = (0.05 + 0.06 * (0.5 + 0.5 * Math.sin(u * 23 + t * 1.1 + band * 4))) * (band === 1 ? 1.2 : 0.8);
      ctx.drawImage(sprite, x, base - tall, stepX + 1, tall);
    }
  }
  ctx.restore();

  const peaks = [
    { base: 0.8, amp: 0.36, freq: 2.6, color: '#0c1830', snow: '#5a719a' },
    { base: 1.0, amp: 0.34, freq: 1.7, color: '#040915', snow: '#22314d' },
  ];
  peaks.forEach((P, pi) => {
    const step = Math.max(2, w / 300);
    const ys = [];
    for (let x = 0; x <= w + step; x += step) {
      const ridge = 1 - Math.abs(fbm(ridgeNoise[pi], (x / w) * P.freq + 3 + t * 0.002 * (pi + 1), 5) * 2 - 1);
      ys.push(h * (P.base - P.amp * Math.pow(ridge, 1.4)));
    }
    ctx.beginPath();
    ctx.moveTo(0, h);
    ys.forEach((y, i) => ctx.lineTo(i * step, y));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = vGradient(ctx, h * (P.base - P.amp), h, [
      [0, P.snow],
      [0.25, P.color],
      [1, P.color],
    ]);
    ctx.fill();
  });
  vignette(ctx, w, h, 0.5);
}

function space(ctx, w, h, t) {
  ctx.fillStyle = '#020208';
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.22, h * 0.3, w * 0.35, 'rgba(90,60,200,0.35)');
  glow(ctx, w * 0.35, h * 0.6, w * 0.25, 'rgba(40,120,200,0.25)');
  stars(ctx, w, h, t, 'space-stars', 260);

  const px = w * 0.64;
  const py = h * 0.8;
  const pr = h * 0.46;
  const tilt = -0.18;
  // back half of the rings
  const ring = (front) => {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.rect(-pr * 3, front ? 0 : -pr * 3, pr * 6, pr * 3);
    ctx.clip();
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = `rgba(${225 - i * 6},${195 - i * 8},${165 - i * 6},${0.22 + (i % 3) * 0.1})`;
      ctx.lineWidth = h * 0.012;
      ctx.beginPath();
      ctx.ellipse(0, 0, pr * (1.35 + i * 0.07), pr * (0.22 + i * 0.012), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };
  ring(false);
  // planet body, lit from the upper left
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, Math.PI * 2);
  ctx.clip();
  const body = ctx.createRadialGradient(px - pr * 0.45, py - pr * 0.55, pr * 0.1, px, py, pr * 1.05);
  body.addColorStop(0, '#f0c99a');
  body.addColorStop(0.45, '#b9784e');
  body.addColorStop(1, '#2a1410');
  ctx.fillStyle = body;
  ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  for (let i = 0; i < 12; i++) {
    const by = py - pr + (i / 12) * pr * 2 + Math.sin(t * 0.1 + i) * 2;
    ctx.fillStyle = i % 2 ? 'rgba(80,40,20,0.18)' : 'rgba(255,220,180,0.08)';
    ctx.beginPath();
    ctx.ellipse(px + Math.sin(t * 0.05 + i) * 10, by, pr * 1.1, pr * 0.05 + (i % 3) * 3, tilt, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.shadowColor = 'rgba(255,200,150,0.8)';
  ctx.shadowBlur = h * 0.05;
  ctx.strokeStyle = 'rgba(255,210,170,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, pr, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();
  ctx.restore();
  ring(true);

  // small moon drifting
  const mx = ((0.08 + t * 0.004) % 1.1) * w;
  const my = h * 0.28;
  const moon = ctx.createRadialGradient(mx - 4, my - 4, 1, mx, my, h * 0.04);
  moon.addColorStop(0, '#e6e8f0');
  moon.addColorStop(1, '#3a3d4a');
  ctx.fillStyle = moon;
  ctx.beginPath();
  ctx.arc(mx, my, h * 0.035, 0, Math.PI * 2);
  ctx.fill();

  // a ship crossing every so often
  const cycle = (t % 14) / 14;
  if (cycle < 0.5) {
    const sx = w * (1.05 - cycle * 2.3);
    const sy = h * (0.18 + cycle * 0.25);
    const trail = ctx.createLinearGradient(sx, sy, sx + w * 0.12, sy - h * 0.05);
    trail.addColorStop(0, 'rgba(160,220,255,0.9)');
    trail.addColorStop(1, 'rgba(160,220,255,0)');
    ctx.strokeStyle = trail;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + w * 0.12, sy - h * 0.05);
    ctx.stroke();
    glow(ctx, sx, sy, h * 0.03, 'rgba(200,240,255,0.95)');
  }
  vignette(ctx, w, h, 0.4);
}

export const SCENES = { desert, ocean, city, aurora, space };

export function drawScene(name, ctx, w, h, t) {
  ctx.save();
  (SCENES[name] || desert)(ctx, w, h, t);
  ctx.restore();
}

/** Still frame for a poster. A nice moment of each film. */
const POSTER_TIME = { desert: 6, ocean: 1.2, city: 4, aurora: 12, space: 3 };

export function drawPoster(name, canvas) {
  const ctx = canvas.getContext('2d');
  drawScene(name, ctx, canvas.width, canvas.height, POSTER_TIME[name] ?? 0);
}
