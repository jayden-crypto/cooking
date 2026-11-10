// Seat map drawn as SVG straight from the layout, so curved rows and aisles match the 3D
// room. The big map is interactive: tap a seat to look from it, or drag across the map
// and the view follows your finger.

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

export class SeatMap {
  constructor(svg, { mini = false, onPreview, onPick } = {}) {
    this.svg = svg;
    this.mini = mini;
    this.onPreview = onPreview;
    this.onPick = onPick;
    this.nodes = new Map();
    this.pos = new Map();
    if (!mini) this.bindPointer();
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
      let node;
      if (seat.access === 'space' && !this.mini) {
        // a wheelchair space: the seat shape with the access symbol on it
        node = el('g', { class: 'map-seat space', transform }, g);
        el('rect', attrs, node);
        const k = Math.min(seatW, seatD) * 0.036;
        const glyph = el('g', { class: 'map-access', transform: `translate(${(seat.x - 12 * k).toFixed(3)} ${(y - 12 * k).toFixed(3)}) scale(${k.toFixed(4)})` }, node);
        el('circle', { cx: 12, cy: 4.4, r: 2.2 }, glyph);
        el('path', { d: 'M11.5 8.5v5.5h5.5l2.6 5.6' }, glyph);
        el('path', { d: 'M8.6 11.2a5.6 5.6 0 1 0 7.4 7.4' }, glyph);
      } else {
        node = el('rect', { ...attrs, transform, class: seat.access === 'space' ? 'map-seat space' : 'map-seat' }, g);
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
    let down = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, moved: false, last: null };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!down) return;
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
      down.moved = true;
      const seat = this.seatAt(e.clientX, e.clientY);
      if (seat && seat.id !== down.last) {
        down.last = seat.id;
        this.onPreview?.(seat, { scrub: true });
      }
    });
    const up = (e) => {
      if (!down) return;
      const wasMoved = down.moved;
      down = null;
      if (wasMoved || e.type === 'pointercancel') return;
      const seat = this.seatAt(e.clientX, e.clientY, { free: false });
      if (seat) this.onPick?.(seat);
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
  }
}
