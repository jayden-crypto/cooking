// Seat map drawn as SVG straight from the layout, so curved rows and aisles match the 3D
// room. The big map is interactive: tap a seat to look from it, or drag across the map
// and the view follows your finger. Two fingers pinch to zoom and pan; zoomed in, seat
// numbers appear and the row letters stay pinned to the left edge.

const NS = 'http://www.w3.org/2000/svg';
const DEPTH = 0.62; // rows are drawn closer together than true scale so the map fits a phone

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}

/** Score (0–100) to a colour from coral through amber to mint. */
export function heatColor(score) {
  const stops = [
    [40, [255, 107, 94]],
    [68, [243, 201, 105]],
    [93, [143, 227, 176]],
  ];
  const s = Math.min(stops[2][0], Math.max(stops[0][0], score));
  const [a, b] = s <= stops[1][0] ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const t = (s - a[0]) / (b[0] - a[0]);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * t));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

/* ---------- zoom maths (pure, so it can be tested) ----------
 * A view is the visible part of the map {x, y, w, h} in map units. `rect` is the SVG's
 * box on screen {left, top, width, height}; the SVG letterboxes (xMidYMid meet). */

export function fitScale(rect, view) {
  return Math.min(rect.width / view.w, rect.height / view.h);
}

/** Screen point → map point. */
export function toMap(rect, view, cx, cy) {
  const s = fitScale(rect, view);
  const ox = rect.left + (rect.width - view.w * s) / 2;
  const oy = rect.top + (rect.height - view.h * s) / 2;
  return { x: view.x + (cx - ox) / s, y: view.y + (cy - oy) / s };
}

/** Keep a view inside the whole map. */
export function clampView(base, v) {
  const w = Math.min(base.w, v.w);
  const h = Math.min(base.h, v.h);
  return {
    // (base.w - w) first, so a fully zoomed-out view lands exactly on the map's edge
    x: Math.min(base.x + (base.w - w), Math.max(base.x, v.x)),
    y: Math.min(base.y + (base.h - h), Math.max(base.y, v.y)),
    w,
    h,
  };
}

/** The view at zoom `z` that keeps map point `pt` under the screen point (cx, cy). */
export function zoomView(base, rect, z, pt, cx, cy) {
  const w = base.w / z;
  const h = base.h / z;
  const s = fitScale(rect, { w, h });
  const ox = rect.left + (rect.width - w * s) / 2;
  const oy = rect.top + (rect.height - h * s) / 2;
  return clampView(base, { x: pt.x - (cx - ox) / s, y: pt.y - (cy - oy) / s, w, h });
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class SeatMap {
  constructor(svg, { mini = false, onPreview, onPick, pins = null, zoomIn = null, zoomOut = null } = {}) {
    this.svg = svg;
    this.mini = mini;
    this.onPreview = onPreview;
    this.onPick = onPick;
    this.pins = pins;
    this.zoomIn = zoomIn;
    this.zoomOut = zoomOut;
    this.nodes = new Map();
    this.pos = new Map();
    this.zoom = 1;
    if (!mini) {
      this.bindPointer();
      this.bindZoomInputs();
    }
  }

  render(layout) {
    this.layout = layout;
    const svg = this.svg;
    svg.replaceChildren();
    this.nodes.clear();
    this.pos.clear();
    const { seats, screen, rows, aud } = layout;
    const pitch = aud.seatPitch;
    const xs = seats.map((s) => s.x);
    const minX = Math.min(...xs, -screen.edgeX) - pitch;
    const maxX = Math.max(...xs, screen.edgeX) + pitch;
    const labelPad = this.mini ? 0.2 : 1.1;
    const top = -1.3;
    const bottom = (rows.at(-1).z + aud.rowPitch * 0.6) * DEPTH;
    const x0 = minX - labelPad;
    const width = maxX - minX + labelPad * 2;
    this.base = { x: x0, y: top, w: width, h: bottom - top };
    cancelAnimationFrame(this.anim);
    this.view = { ...this.base };
    this.zoom = 1;
    svg.setAttribute('viewBox', `${x0} ${top} ${width} ${bottom - top}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // the screen, drawn with its curve
    const steps = 24;
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const u = -1 + (2 * i) / steps;
      const arc = (u * screen.width) / 2;
      const x = screen.radius ? screen.radius * Math.sin(arc / screen.radius) : arc;
      const z = screen.radius ? screen.radius * (1 - Math.cos(arc / screen.radius)) : 0;
      d += `${i ? 'L' : 'M'}${x.toFixed(3)} ${(z * DEPTH - 0.7).toFixed(3)}`;
    }
    if (!this.mini) el('path', { d, class: 'map-screen-glow' }, svg);
    el('path', { d, class: 'map-screen' }, svg);
    if (!this.mini) {
      const label = el('text', { x: 0, y: 0.25, class: 'map-screen-label', 'text-anchor': 'middle' }, svg);
      label.textContent = 'SCREEN';
    }

    const seatW = Math.min(pitch * 0.78, 0.72);
    const seatD = Math.min(aud.rowPitch * DEPTH * 0.58, 0.5);
    const g = el('g', { class: 'map-seats' }, svg);
    for (const seat of seats) {
      const y = seat.z * DEPTH;
      this.pos.set(seat.id, { x: seat.x, y });
      // follow the row's curve as it looks once squashed
      const rot = (-Math.atan(DEPTH * Math.tan(seat.yaw)) * 180) / Math.PI;
      const attrs = {
        x: (seat.x - seatW / 2).toFixed(3),
        y: (y - seatD / 2).toFixed(3),
        width: seatW.toFixed(3),
        height: seatD.toFixed(3),
        rx: (seatD * 0.32).toFixed(3),
      };
      const transform = `rotate(${rot.toFixed(2)} ${seat.x.toFixed(3)} ${y.toFixed(3)})`;
      // one group per seat: its shape, plus the access symbol or the seat number
      const node = el('g', { class: seat.access === 'space' ? 'map-seat space' : 'map-seat', transform }, g);
      el('rect', attrs, node);
      if (seat.access === 'space' && !this.mini) {
        const k = Math.min(seatW, seatD) * 0.036;
        const glyph = el('g', { class: 'map-access', transform: `translate(${(seat.x - 12 * k).toFixed(3)} ${(y - 12 * k).toFixed(3)}) scale(${k.toFixed(4)})` }, node);
        el('circle', { cx: 12, cy: 4.4, r: 2.2 }, glyph);
        el('path', { d: 'M11.5 8.5v5.5h5.5l2.6 5.6' }, glyph);
        el('path', { d: 'M8.6 11.2a5.6 5.6 0 1 0 7.4 7.4' }, glyph);
      } else if (!this.mini) {
        const num = el('text', {
          x: seat.x.toFixed(3),
          y: (y + seatD * 0.19).toFixed(3),
          'font-size': (Math.min(seatW, seatD) * 0.52).toFixed(3),
          'text-anchor': 'middle',
          class: 'map-num',
        }, node);
        num.textContent = seat.number;
      }
      this.nodes.set(seat.id, node);
    }

    if (!this.mini) {
      const labels = el('g', { class: 'map-rows' }, svg);
      for (const row of rows) {
        const first = row.seats[0];
        const last = row.seats.at(-1);
        for (const [s, side] of [
          [first, -1],
          [last, 1],
        ]) {
          const t = el('text', {
            x: (s.x + side * (pitch * 0.5 + 0.55)).toFixed(3),
            y: (s.z * DEPTH + 0.14).toFixed(3),
            'text-anchor': 'middle',
          }, labels);
          t.textContent = row.label;
        }
      }
    }
    if (this.pins) {
      this.pins.replaceChildren();
      this.pinSpans = rows.map((row) => {
        const span = document.createElement('span');
        span.textContent = row.label;
        this.pins.append(span);
        return { row, span };
      });
    }
    this.syncChrome();
  }

  /* ---------- zoom ---------- */

  rect() {
    return this.svg.getBoundingClientRect();
  }

  /** Enough zoom for a seat to be a comfortable finger target (about 44 px), 2.5×–6×. */
  maxZoom() {
    const r = this.rect();
    if (!r.width || !this.base) return 4;
    const px = this.layout.aud.seatPitch * fitScale(r, this.base);
    return Math.min(6, Math.max(2.5, 44 / px));
  }

  setView(v) {
    this.view = clampView(this.base, v);
    this.zoom = this.base.w / this.view.w;
    const { x, y, w, h } = this.view;
    this.svg.setAttribute('viewBox', `${x.toFixed(3)} ${y.toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}`);
    this.syncChrome();
  }

  /** Classes, pinned row letters and the zoom buttons, to match the current view. */
  syncChrome() {
    if (this.mini || !this.base) return;
    const zoomed = this.zoom > 1.12;
    this.svg.classList.toggle('zoomed', zoomed);
    this.svg.classList.toggle('numbers', this.zoom >= 1.8);
    if (this.zoomOut) this.zoomOut.disabled = this.zoom <= 1.001;
    if (this.zoomIn) this.zoomIn.disabled = this.zoom >= this.maxZoom() - 0.01;
    if (!this.pins) return;
    this.pins.classList.toggle('on', zoomed);
    if (!zoomed) return;
    const r = this.rect();
    const v = this.view;
    const sc = fitScale(r, v);
    const oy = (r.height - v.h * sc) / 2;
    for (const { row, span } of this.pinSpans || []) {
      // the row's height at the left edge of the view (rows curve)
      let near = row.seats[0];
      for (const s of row.seats) if (Math.abs(s.x - v.x) < Math.abs(near.x - v.x)) near = s;
      const top = oy + (this.pos.get(near.id).y - v.y) * sc;
      span.style.transform = `translateY(${top.toFixed(1)}px) translateY(-50%)`;
      span.hidden = top < 6 || top > r.height - 6;
    }
  }

  animateTo(target, duration = 260) {
    cancelAnimationFrame(this.anim);
    const to = clampView(this.base, target);
    if (reduceMotion()) return this.setView(to);
    const from = { ...this.view };
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const k = easeOut(t);
      this.setView({
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
        w: from.w + (to.w - from.w) * k,
        h: from.h + (to.h - from.h) * k,
      });
      if (t < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  /** Zoom to `z` around a screen point (the middle of the map if none). */
  zoomTo(z, cx, cy, { animate = true } = {}) {
    const r = this.rect();
    if (!r.width || !this.base) return;
    cx ??= r.left + r.width / 2;
    cy ??= r.top + r.height / 2;
    const zz = Math.min(this.maxZoom(), Math.max(1, z));
    const target = zz <= 1.001 ? { ...this.base } : zoomView(this.base, r, zz, toMap(r, this.view, cx, cy), cx, cy);
    if (animate) this.animateTo(target);
    else this.setView(target);
  }

  zoomBy(factor, cx, cy, opts) {
    this.zoomTo(this.zoom * factor, cx, cy, opts);
  }

  fit() {
    this.animateTo({ ...this.base });
  }

  /** When zoomed in, slide the map so this seat is in view (if it isn't already). */
  ensureVisible(id) {
    if (this.zoom <= 1.01 || this.gesturing || !this.pos.has(id)) return;
    const p = this.pos.get(id);
    const v = this.view;
    const m = this.layout.aud.seatPitch * 1.2;
    if (p.x > v.x + m && p.x < v.x + v.w - m && p.y > v.y + m && p.y < v.y + v.h - m) return;
    this.animateTo({ x: p.x - v.w / 2, y: p.y - v.h / 2, w: v.w, h: v.h }, 320);
  }

  bindZoomInputs() {
    // trackpad pinch and ⌘/Ctrl + scroll; plain scrolling still scrolls the page
    this.svg.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        cancelAnimationFrame(this.anim);
        this.zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY, { animate: false });
      },
      { passive: false },
    );
    // Safari's own pinch gesture would zoom the whole page
    this.svg.addEventListener('gesturestart', (e) => e.preventDefault());
    this.zoomIn?.addEventListener('click', () => this.zoomBy(1.7));
    this.zoomOut?.addEventListener('click', () => this.zoomBy(1 / 1.7));
    window.addEventListener('resize', () => this.syncChrome());
  }

  /** state: { taken:Set, mine:Set, selected:Set, focus:id, heat:bool } */
  update(state) {
    if (!this.layout) return;
    for (const seat of this.layout.seats) {
      const node = this.nodes.get(seat.id);
      const taken = state.taken.has(seat.id) && !state.mine.has(seat.id);
      const cls = ['map-seat'];
      if (seat.access === 'space') cls.push('space');
      if (taken) cls.push('taken');
      else if (state.mine.has(seat.id)) cls.push('mine');
      if (seat.premium && !this.mini) cls.push('premium');
      if (state.selected.has(seat.id)) cls.push('selected');
      if (state.focus === seat.id) cls.push('focus');
      node.setAttribute('class', cls.join(' '));
      if (state.heat && !taken && !this.mini && !state.selected.has(seat.id) && state.focus !== seat.id) {
        node.style.fill = heatColor(seat.metrics.score);
      } else {
        node.style.fill = '';
      }
    }
    this.state = state;
    if (!this.mini && state.focus !== this.lastFocus) {
      this.lastFocus = state.focus;
      this.ensureVisible(state.focus);
    }
  }

  seatAt(clientX, clientY, { free = true } = {}) {
    const ctm = this.svg.getScreenCTM();
    if (!ctm || !this.layout) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    let best = null;
    let bestD = Infinity;
    for (const seat of this.layout.seats) {
      if (free && this.state && this.state.taken.has(seat.id) && !this.state.mine.has(seat.id)) continue;
      const p = this.pos.get(seat.id);
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d < bestD) {
        bestD = d;
        best = seat;
      }
    }
    const reach = Math.max(this.layout.aud.seatPitch, this.layout.aud.rowPitch * DEPTH) * 0.9;
    return bestD <= reach ? best : null;
  }

  bindPointer() {
    const svg = this.svg;
    const pointers = new Map();
    let down = null; // one finger: tap or scrub
    let pinch = null; // two fingers: zoom and pan
    let lastTap = null;
    let edgeRaf = 0;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    const preview = () => {
      const seat = this.seatAt(down.cx, down.cy);
      if (seat && seat.id !== down.last) {
        down.last = seat.id;
        this.onPreview?.(seat, { scrub: true });
      }
    };
    // zoomed in, holding a scrub near an edge scrolls the map that way
    const stopEdge = () => {
      cancelAnimationFrame(edgeRaf);
      edgeRaf = 0;
    };
    const edgePan = () => {
      if (this.zoom <= 1.01) return stopEdge();
      const r = this.rect();
      const zone = 34;
      const push = (p, lo, hi) => (p < lo + zone ? -(1 - (p - lo) / zone) : p > hi - zone ? 1 - (hi - p) / zone : 0);
      down.vx = push(down.cx, r.left, r.right);
      down.vy = push(down.cy, r.top, r.bottom);
      if (!down.vx && !down.vy) return stopEdge();
      if (edgeRaf) return;
      const tick = () => {
        if (!down || (!down.vx && !down.vy)) return stopEdge();
        const v = this.view;
        this.setView({ ...v, x: v.x + down.vx * v.w * 0.018, y: v.y + down.vy * v.h * 0.018 });
        preview();
        edgeRaf = requestAnimationFrame(tick);
      };
      edgeRaf = requestAnimationFrame(tick);
    };

    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      svg.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      cancelAnimationFrame(this.anim);
      // while a finger is down the map never moves by itself (no auto-pan to the seat)
      this.gesturing = true;
      if (pointers.size === 1) {
        down = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, moved: false, last: null };
      } else if (pointers.size === 2) {
        // a second finger turns the gesture into a pinch; the scrub stops where it is
        down = null;
        stopEdge();
        const [a, b] = [...pointers.values()];
        const m = mid(a, b);
        pinch = { d0: Math.max(1, dist(a, b)), z0: this.zoom, pt: toMap(this.rect(), this.view, m.x, m.y) };
      }
    });

    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const m = mid(a, b);
        const z = Math.min(this.maxZoom(), Math.max(1, (pinch.z0 * dist(a, b)) / pinch.d0));
        // the map point that started under your fingers stays under them
        this.setView(z <= 1.001 ? { ...this.base } : zoomView(this.base, this.rect(), z, pinch.pt, m.x, m.y));
        return;
      }
      if (!down || e.pointerId !== down.id) return;
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
      down.moved = true;
      down.cx = e.clientX;
      down.cy = e.clientY;
      preview();
      edgePan();
    });

    const up = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pinch) {
        // stay out of scrubbing until every finger is up
        if (pointers.size < 2) pinch = null;
        if (pointers.size === 0) this.gesturing = false;
        return;
      }
      if (pointers.size === 0) this.gesturing = false;
      if (!down || e.pointerId !== down.id) return;
      stopEdge();
      const d = down;
      down = null;
      if (d.moved || e.type === 'pointercancel') return;
      const seat = this.seatAt(e.clientX, e.clientY, { free: false });
      if (seat) this.onPick?.(seat);
      // double-tap: zoom in on that spot, or back out if already close in (timed by the
      // events themselves, so a busy main thread can't stretch the gap between taps)
      const now = e.timeStamp;
      if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        if (this.zoom < this.maxZoom() * 0.7) this.zoomTo(this.zoom * 2.2, e.clientX, e.clientY);
        else this.fit();
        lastTap = null;
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
  }
}
