// Auditorium geometry and seat scoring. No DOM, no three.js — the 3D scene, the seat map
// and the tests all build on these numbers, so what the card says matches what you see.
//
// Coordinates are metres. The centre of the screen is at x = 0, z = 0 and the audience
// sits towards +z. x runs left → right as you face the screen, y is up from the front floor.

const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, like most cinemas

const deg = (rad) => (rad * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Seat styles: how big the seat is and where a seated person's eyes end up. */
export const SEAT_STYLES = {
  classic: { eyeHeight: 1.15, eyeBack: 0.1, width: 0.54, backTop: 1.04, depth: 0.5 },
  recliner: { eyeHeight: 1.05, eyeBack: 0.22, width: 0.78, backTop: 1.08, depth: 0.7 },
};

export function buildLayout(aud) {
  const style = SEAT_STYLES[aud.style || 'classic'];
  const W = aud.screenWidth;
  const H = W / (aud.screenAspect || 2.39);
  const R = aud.curve ? W * aud.curve : 0; // radius of the screen curve, 0 = flat
  const half = W / 2;
  const edgeX = R ? R * Math.sin(half / R) : half;
  const edgeZ = R ? R * (1 - Math.cos(half / R)) : 0;
  const screen = {
    width: W,
    height: H,
    bottom: aud.screenBottom,
    top: aud.screenBottom + H,
    centerY: aud.screenBottom + H / 2,
    radius: R,
    edgeX,
    edgeZ,
  };

  const blocks = aud.blocks;
  const perRow = blocks.reduce((a, b) => a + b, 0);
  const span = perRow * aud.seatPitch + (blocks.length - 1) * aud.aisleWidth;
  const arcCentre = aud.rowArc ?? 24; // rows are arcs around a point this far behind the screen
  const flatRows = aud.flatRows ?? 1;
  const premiumFrom = aud.rows - (aud.premiumRows || 0);

  const rows = [];
  const seats = [];
  for (let r = 0; r < aud.rows; r++) {
    const label = ROW_LETTERS[r];
    const rowZ = aud.firstRow + r * aud.rowPitch;
    const floorY = r < flatRows ? 0 : (r - flatRows + 1) * aud.riser;
    const rho = rowZ + arcCentre;
    const row = { index: r, label, z: rowZ, floorY, radius: rho, seats: [] };
    rows.push(row);

    let s = -span / 2;
    let number = 1;
    blocks.forEach((count, b) => {
      for (let i = 0; i < count; i++) {
        const arc = s + (i + 0.5) * aud.seatPitch;
        const yaw = arc / rho;
        const x = rho * Math.sin(yaw);
        const z = -arcCentre + rho * Math.cos(yaw);
        const eye = {
          x: x + Math.sin(yaw) * style.eyeBack,
          y: floorY + style.eyeHeight,
          z: z + Math.cos(yaw) * style.eyeBack,
        };
        const seat = {
          id: `${label}${number}`,
          row: r,
          rowLabel: label,
          number,
          block: b,
          arc,
          x,
          z,
          floorY,
          yaw,
          eye,
          aisle: i === 0 ? 'left' : i === count - 1 ? 'right' : null,
          premium: aud.allPremium || r >= premiumFrom,
          access: null,
        };
        seats.push(seat);
        row.seats.push(seat);
        number++;
      }
      s += count * aud.seatPitch + aud.aisleWidth;
    });
  }

  // wheelchair spaces: the aisle ends of the middle block on a step-free row, each with a
  // companion seat beside it
  if (aud.accessRow != null && rows[aud.accessRow]?.floorY === 0) {
    const row = rows[aud.accessRow];
    const middle = row.seats.filter((s) => s.block === Math.floor(blocks.length / 2));
    if (middle.length >= 4) {
      middle[0].access = 'space';
      middle[1].access = 'companion';
      middle[middle.length - 1].access = 'space';
      middle[middle.length - 2].access = 'companion';
    }
  }

  const back = rows[rows.length - 1];
  const roomWidth = Math.max(W + 4, span + 2 * (aud.sideAisle ?? 1.4));
  const room = {
    width: roomWidth,
    backZ: back.z + aud.rowPitch / 2 + 1.2,
    backFloor: back.floorY,
    ceiling: Math.max(screen.top + 2.2, back.floorY + 4.2),
  };

  const layout = { aud, style, screen, rows, seats, span, perRow, room, byId: new Map() };
  for (const seat of seats) layout.byId.set(seat.id, seat);
  for (const seat of seats) seat.metrics = seatMetrics(seat, layout);
  return layout;
}

function angleBetween(a, b) {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(clamp(dot / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)), -1, 1));
}

/** Sightline clearance ("C-value"): how far the line from your eye to the bottom of the
 *  screen passes above the eyes of the person in front. ~6 cm is the usual minimum,
 *  12 cm means you see over their head. Null for the front row. */
function clearance(seat, layout) {
  if (seat.row === 0) return null;
  const { screen } = layout;
  const E = seat.eye;
  const B = { x: 0, y: screen.bottom, z: 0 };
  const dx = B.x - E.x;
  const dz = B.z - E.z;
  const len = Math.hypot(dx, dz);
  // The person in front is whoever sits closest to the line towards the screen.
  let best = null;
  let bestOff = Infinity;
  for (const other of layout.rows[seat.row - 1].seats) {
    const ox = other.eye.x - E.x;
    const oz = other.eye.z - E.z;
    const off = Math.abs(ox * dz - oz * dx) / len;
    if (off < bestOff) {
      bestOff = off;
      best = other;
    }
  }
  if (!best || bestOff > layout.aud.seatPitch * 0.75) return null; // aisle in front of you
  const t = ((best.eye.x - E.x) * dx + (best.eye.z - E.z) * dz) / (len * len);
  const lineY = E.y + (B.y - E.y) * t;
  return lineY - best.eye.y;
}

export function seatMetrics(seat, layout) {
  const { screen } = layout;
  const E = seat.eye;
  const toLeft = { x: -screen.edgeX - E.x, y: screen.centerY - E.y, z: screen.edgeZ - E.z };
  const toRight = { x: screen.edgeX - E.x, y: screen.centerY - E.y, z: screen.edgeZ - E.z };
  const toTop = { x: -E.x, y: screen.top - E.y, z: -E.z };
  const toBottom = { x: -E.x, y: screen.bottom - E.y, z: -E.z };
  const flat = Math.hypot(E.x, E.z);

  const fov = deg(angleBetween(toLeft, toRight));
  const verticalFov = deg(angleBetween(toTop, toBottom));
  const offAxis = deg(Math.atan2(Math.abs(E.x), E.z));
  const lookUp = deg(Math.atan2(screen.centerY - E.y, flat));
  const c = clearance(seat, layout);

  // How much of your vision the picture fills: about 52–60° is the cinema sweet spot,
  // further back is calmer, closer means turning your head.
  const fovGap = Math.max(0, Math.abs(fov - 56) - 3);
  const fovScore = Math.exp(-(fovGap * fovGap) / (2 * 9 * 9));
  const axisScore = 1 - clamp((offAxis - 1) / 32, 0, 1);
  const neckScore = 1 - clamp((lookUp - 8) / 22, 0, 1) - clamp((-lookUp - 8) / 20, 0, 1);
  const sightScore = c === null ? 1 : clamp((c + 0.02) / 0.14, 0, 1);
  const score = Math.round(100 * (0.42 * fovScore + 0.3 * axisScore + 0.16 * neckScore + 0.12 * sightScore));

  return {
    distance: flat,
    fov,
    verticalFov,
    offset: E.x,
    offAxis,
    lookUp,
    clearance: c,
    score,
    ...verdict({ fov, offAxis, score }),
  };
}

function verdict({ fov, offAxis, score }) {
  if (score >= 93) return { label: 'Sweet spot', tone: 'great' };
  if (fov > 74) return { label: 'Up close', tone: 'warn' };
  if (offAxis > 22) return { label: 'Side view', tone: 'warn' };
  if (fov < 38) return { label: 'Relaxed view', tone: 'calm' };
  if (score >= 78) return { label: 'Great view', tone: 'good' };
  return { label: 'Good view', tone: 'neutral' };
}

/** A line or two about the view, for under the numbers. */
export function describeView(m) {
  let size;
  if (m.fov > 74) size = 'Wider than you can take in at once, so you’ll turn your head.';
  else if (m.fov > 62) size = 'A big, immersive picture that fills your view.';
  else if (m.fov >= 46) size = 'The picture fills the ideal part of your vision.';
  else if (m.fov >= 36) size = 'Comfortable, with the whole frame at a glance.';
  else size = 'A smaller picture, a bit like a big TV at home.';

  let angle;
  if (m.offAxis < 3) angle = 'You’re dead-on to the centre.';
  else if (m.offAxis < 10) angle = 'Just off-centre.';
  else angle = 'You see it at a noticeable angle.';

  const blocked = m.clearance !== null && m.clearance < 0.05 ? ' Heads in front may clip the bottom.' : '';
  return `${size} ${angle}${blocked}`;
}

export function formatOffset(x) {
  const v = Math.abs(x);
  if (v < 0.05) return { value: 'Centre', unit: 'dead on' };
  return { value: `${v.toFixed(1)} m`, unit: x > 0 ? 'right of centre' : 'left of centre' };
}

export function formatClearance(c) {
  if (c === null) return 'Nobody in front of you';
  if (c >= 0.12) return 'Clear view over heads';
  if (c >= 0.06) return 'Good sightline over the row in front';
  return 'Heads in front may get in the way';
}

/** Best free seat: highest score, ties go to the most central. */
export function bestSeat(layout, isFree = () => true) {
  let best = null;
  for (const seat of layout.seats) {
    if (!isFree(seat)) continue;
    if (
      !best ||
      seat.metrics.score > best.metrics.score ||
      (seat.metrics.score === best.metrics.score && Math.abs(seat.x) < Math.abs(best.x))
    ) {
      best = seat;
    }
  }
  return best;
}

/* ---------- seats together ---------- */

function rowRuns(row, size, isFree) {
  const runs = [];
  for (let i = 0; i + size <= row.seats.length; i++) {
    const seats = row.seats.slice(i, i + size);
    if (seats.some((s) => s.block !== seats[0].block || !isFree(s))) continue; // no aisle in the middle
    const scores = seats.map((s) => s.metrics.score);
    const mean = scores.reduce((a, b) => a + b, 0) / size;
    runs.push({
      seats,
      // a group is only as happy as its worst seat, so that counts too
      score: Math.round(0.6 * mean + 0.4 * Math.min(...scores)),
      centre: seats.reduce((a, s) => a + s.x, 0) / size,
      row: row.index,
    });
  }
  return runs;
}

/** Every run of `size` free seats side by side (same row, same block), best first. */
export function seatGroups(layout, size, isFree = () => true) {
  return layout.rows
    .flatMap((row) => rowRuns(row, size, isFree))
    .sort((a, b) => b.score - a.score || Math.abs(a.centre) - Math.abs(b.centre));
}

/** The best group of `size` that includes `seat`. If its neighbours are taken, the group
 *  nearest to it (`moved: true`). Null when no `size` free seats sit together anywhere. */
export function groupAround(layout, seat, size, isFree = () => true) {
  if (size <= 1) return isFree(seat) ? { seats: [seat], score: seat.metrics.score, moved: false } : null;
  const own = rowRuns(layout.rows[seat.row], size, isFree)
    .filter((g) => g.seats.includes(seat))
    .sort((a, b) => b.score - a.score || Math.abs(a.centre - seat.x) - Math.abs(b.centre - seat.x));
  if (own.length) return { ...own[0], moved: false };
  const pitch = layout.aud.rowPitch;
  let best = null;
  let bestD = Infinity;
  for (const g of seatGroups(layout, size, isFree)) {
    const d = Math.hypot((g.row - seat.row) * pitch, g.centre - seat.x);
    if (d < bestD - 1e-9) {
      best = g;
      bestD = d;
    }
  }
  return best ? { ...best, moved: true } : null;
}

/** True when the seats are side by side in one row with no aisle or gap between them. */
export function isTogether(layout, ids) {
  const seats = ids.map((id) => layout.byId.get(id)).filter(Boolean);
  if (seats.length !== ids.length || !seats.length) return false;
  const { row, block } = seats[0];
  if (seats.some((s) => s.row !== row || s.block !== block)) return false;
  const nums = seats.map((s) => s.number).sort((a, b) => a - b);
  return nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
}
