import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUDITORIUMS, findShow, showsFor, takenSeats, priceOf, upcomingDays } from '../js/data.js';
import { bestSeat, buildLayout, describeView, formatClearance, formatOffset } from '../js/layout.js';
import { heatColor } from '../js/seatmap.js';

const layouts = Object.fromEntries(Object.values(AUDITORIUMS).map((a) => [a.id, buildLayout(a)]));

test('every screen has rows × seats, numbered left to right', () => {
  for (const [id, L] of Object.entries(layouts)) {
    const aud = AUDITORIUMS[id];
    assert.equal(L.seats.length, aud.rows * aud.blocks.reduce((a, b) => a + b, 0), id);
    for (const row of L.rows) {
      const xs = row.seats.map((s) => s.x);
      assert.deepEqual(xs, [...xs].sort((a, b) => a - b), `${id} row ${row.label} runs left to right`);
      assert.equal(row.seats[0].number, 1);
    }
    assert.ok(L.byId.has('A1'));
    assert.ok(!L.rows.some((r) => r.label === 'I' || r.label === 'O'), 'no row I or O');
  }
});

test('further back means further away and a narrower picture', () => {
  const L = layouts.grand;
  const middle = L.rows.map((r) => r.seats[Math.floor(r.seats.length / 2)].metrics);
  for (let i = 1; i < middle.length; i++) {
    assert.ok(middle[i].distance > middle[i - 1].distance);
    assert.ok(middle[i].fov < middle[i - 1].fov);
  }
});

test('the two middle seats sit half a seat either side of centre', () => {
  const L = layouts.studio; // 4 + 10 + 4, so seats 9 and 10 straddle the centre line
  const left = L.byId.get('F9').metrics.offset;
  const right = L.byId.get('F10').metrics.offset;
  assert.ok(Math.abs(left + 0.3) < 0.02, `F9 is ${left}`);
  assert.ok(Math.abs(right - 0.3) < 0.02, `F10 is ${right}`);
  assert.deepEqual(formatOffset(right), { value: '0.3 m', unit: 'right of centre' });
  assert.deepEqual(formatOffset(left), { value: '0.3 m', unit: 'left of centre' });
  assert.equal(formatOffset(0.01).value, 'Centre');
});

test('field of view matches the geometry for a centre seat', () => {
  const L = layouts.studio; // flat 11 m screen
  const seat = L.byId.get('H9');
  const d = seat.eye.z;
  const expected = (2 * Math.atan(Math.hypot(5.5, 0) / Math.hypot(d, L.screen.centerY - seat.eye.y)) * 180) / Math.PI;
  // off-centre by 0.3 m changes this by a hair, nothing more
  assert.ok(Math.abs(seat.metrics.fov - expected) < 0.5, `${seat.metrics.fov} vs ${expected}`);
});

test('stadium rake gives a clear sightline; the front row has nobody in front', () => {
  for (const L of Object.values(layouts)) {
    assert.equal(L.byId.get('A1').metrics.clearance, null);
    const raked = L.rows[3].seats[Math.floor(L.rows[3].seats.length / 2)];
    assert.ok(raked.metrics.clearance > 0.06, `${L.aud.id} ${raked.id} clearance ${raked.metrics.clearance}`);
  }
  assert.equal(formatClearance(null), 'Nobody in front of you');
  assert.equal(formatClearance(0.2), 'Clear view over heads');
  assert.equal(formatClearance(0.02), 'Heads in front may get in the way');
});

test('the best seat is a centred sweet spot in the back half; the front row is up close', () => {
  for (const L of Object.values(layouts)) {
    const best = bestSeat(L);
    assert.equal(best.metrics.label, 'Sweet spot', L.aud.id);
    assert.ok(best.row >= Math.floor(L.rows.length / 3), `${L.aud.id} best is ${best.id}`);
    assert.ok(Math.abs(best.metrics.offset) < 1, `${L.aud.id} best is ${best.id}`);
    const front = L.rows[0].seats[Math.floor(L.rows[0].seats.length / 2)];
    assert.equal(front.metrics.label, 'Up close', L.aud.id);
    const sweet = L.seats.filter((s) => s.metrics.label === 'Sweet spot').length;
    assert.ok(sweet >= 3 && sweet < L.seats.length * 0.2, `${L.aud.id} has ${sweet} sweet spots`);
  }
});

test('bestSeat skips taken seats', () => {
  const L = layouts.studio;
  const first = bestSeat(L);
  const second = bestSeat(L, (s) => s.id !== first.id);
  assert.notEqual(second.id, first.id);
  assert.ok(second.metrics.score <= first.metrics.score);
});

test('descriptions stay short', () => {
  for (const L of Object.values(layouts)) {
    for (const seat of L.seats) {
      const text = describeView(seat.metrics);
      assert.ok(text.length < 130, text);
      assert.match(text, /\.$/);
    }
  }
});

test('occupancy is stable per show and differs between shows', () => {
  const day = upcomingDays(1, new Date(2026, 10, 9))[0].key;
  const shows = showsFor(day);
  assert.equal(shows.length, 12);
  const show = shows.find((s) => s.aud.id === 'grand');
  const L = layouts.grand;
  const a = takenSeats(show, L);
  const b = takenSeats(findShow(show.id), L);
  assert.deepEqual([...a].sort(), [...b].sort());
  const other = shows.find((s) => s.aud.id === 'grand' && s.id !== show.id);
  assert.notDeepEqual([...takenSeats(other, L)].sort(), [...a].sort());
  for (const s of shows) {
    const fill = takenSeats(s, layouts[s.aud.id]).size / layouts[s.aud.id].seats.length;
    assert.ok(fill > 0.05 && fill < 0.9, `${s.id} is ${fill} full`);
  }
});

test('show ids round-trip and bad ids are rejected', () => {
  const show = showsFor('2026-11-10')[0];
  assert.equal(findShow(show.id).id, show.id);
  assert.equal(findShow('nonsense'), null);
  assert.equal(findShow('2026-11-10_nope_1200'), null);
  assert.equal(findShow('2026-11-10-nope-1200'), null);
});

test('premium rows cost more', () => {
  const aud = AUDITORIUMS.grand;
  const L = layouts.grand;
  assert.ok(priceOf(L.byId.get('N10'), aud) > priceOf(L.byId.get('C10'), aud));
});

test('heat colours run from coral to mint', () => {
  assert.equal(heatColor(0), 'rgb(255 107 94)');
  assert.equal(heatColor(100), 'rgb(143 227 176)');
  assert.equal(heatColor(68), 'rgb(243 201 105)');
});

test('page addresses round-trip and use only letters, digits and hyphens', async () => {
  const { routes, parseRoute } = await import('../js/routes.js');
  const show = showsFor('2026-11-12').find((s) => s.film.id === 'long-quiet');
  for (const hash of [
    routes.show(show.id),
    routes.show(show.id, 'F8'),
    routes.checkout(show.id, ['F8', 'F9', 'K12']),
    routes.ticket('RWC-4C4'),
    routes.home(),
  ]) {
    assert.match(hash, /^#[A-Za-z0-9-]+$/, hash);
  }
  assert.deepEqual(parseRoute(routes.show(show.id)), { page: 'show', id: show.id, seat: null });
  assert.deepEqual(parseRoute(routes.show(show.id, 'F8')), { page: 'show', id: show.id, seat: 'F8' });
  assert.deepEqual(parseRoute(routes.checkout(show.id, ['F8', 'K12'])), { page: 'checkout', id: show.id, seats: ['F8', 'K12'] });
  assert.deepEqual(parseRoute('#ticket-RWC-4C4'), { page: 'ticket', ref: 'RWC-4C4' });
  assert.equal(findShow(parseRoute(routes.show(show.id, 'F8')).id).film.title, 'The Long Quiet');
  for (const junk of ['', '#', '#home', '#show-', '#show-2026-11-12', '#/show/x', '#checkout-x-seats-', '#settings']) {
    assert.equal(parseRoute(junk).page, 'home', junk);
  }
});

test('seat groups are side by side, never across an aisle, best first', async () => {
  const { seatGroups, isTogether } = await import('../js/layout.js');
  const L = layouts.studio; // blocks of 4, 10, 4
  const pairs = seatGroups(L, 2);
  assert.equal(pairs.length, L.rows.length * (3 + 9 + 3));
  for (const g of pairs) assert.ok(isTogether(L, g.seats.map((s) => s.id)), g.seats.map((s) => s.id).join());
  for (let i = 1; i < pairs.length; i++) assert.ok(pairs[i - 1].score >= pairs[i].score);
  assert.equal(pairs[0].seats.length, 2);
  assert.ok(pairs[0].seats.every((s) => s.block === 1), 'best pair is in the middle block');
  // a block of 4 can't seat 5 together, so only the middle block offers fives
  assert.ok(seatGroups(L, 5).every((g) => g.seats[0].block === 1));
  assert.equal(seatGroups(L, 11).length, 0);
});

test('groups skip taken seats', async () => {
  const { seatGroups } = await import('../js/layout.js');
  const L = layouts.studio;
  const taken = new Set(['F9', 'F10']);
  const groups = seatGroups(L, 2, (s) => !taken.has(s.id));
  assert.ok(groups.every((g) => g.seats.every((s) => !taken.has(s.id))));
});

test('groupAround keeps you in your seat, or finds the nearest group when you can’t', async () => {
  const { groupAround } = await import('../js/layout.js');
  const L = layouts.studio;
  const seat = L.byId.get('F9');
  const g = groupAround(L, seat, 2);
  assert.equal(g.moved, false);
  assert.ok(g.seats.includes(seat));
  assert.equal(groupAround(L, seat, 1).seats[0], seat);

  // both neighbours taken: the pair moves, but stays close
  const taken = new Set(['F8', 'F10']);
  const free = (s) => !taken.has(s.id);
  const moved = groupAround(L, seat, 2, free);
  assert.equal(moved.moved, true);
  assert.ok(!moved.seats.includes(seat));
  assert.ok(Math.abs(moved.seats[0].row - seat.row) <= 1, `moved to ${moved.seats.map((s) => s.id)}`);

  // nothing free at all
  assert.equal(groupAround(L, seat, 2, () => false), null);
});

test('isTogether spots gaps, aisles and mixed rows', async () => {
  const { isTogether } = await import('../js/layout.js');
  const L = layouts.studio;
  assert.equal(isTogether(L, ['F9', 'F10']), true);
  assert.equal(isTogether(L, ['F10', 'F9', 'F11']), true);
  assert.equal(isTogether(L, ['F9', 'F11']), false, 'gap');
  assert.equal(isTogether(L, ['F4', 'F5']), false, 'aisle between blocks');
  assert.equal(isTogether(L, ['F9', 'G10']), false, 'different rows');
  assert.equal(isTogether(L, ['F9', 'Z99']), false);
});

test('each room has two step-free wheelchair spaces with a companion seat beside each', async () => {
  const { seatType } = await import('../js/data.js');
  for (const L of Object.values(layouts)) {
    const spaces = L.seats.filter((s) => s.access === 'space');
    const companions = L.seats.filter((s) => s.access === 'companion');
    assert.equal(spaces.length, 2, L.aud.id);
    assert.equal(companions.length, 2, L.aud.id);
    for (const sp of spaces) {
      assert.equal(sp.floorY, 0, 'step-free');
      assert.ok(sp.aisle || L.rows[sp.row].seats.some((n) => n.block !== sp.block && Math.abs(n.number - sp.number) === 1), 'next to an aisle');
      const row = L.rows[sp.row].seats;
      const i = row.indexOf(sp);
      const neighbour = [row[i - 1], row[i + 1]].find((n) => n && n.block === sp.block);
      assert.equal(neighbour.access, 'companion', `${sp.id} has a companion beside it`);
      assert.equal(seatType(sp, L.aud), 'Wheelchair space');
      assert.equal(seatType(neighbour, L.aud), 'Companion seat');
    }
  }
});

test('best seats and groups never hand a wheelchair space to someone who did not choose it', async () => {
  const { seatGroups, groupAround } = await import('../js/layout.js');
  const L = layouts.grand;
  const general = (s) => s.access !== 'space';
  assert.ok(seatGroups(L, 2, general).every((g) => g.seats.every(general)));
  assert.ok(seatGroups(L, 1, general).every((g) => g.seats.every(general)));
  // but from the space itself, a pair is the space plus its companion
  const space = L.seats.find((s) => s.access === 'space');
  const pair = groupAround(L, space, 2, () => true);
  assert.equal(pair.moved, false);
  assert.deepEqual(pair.seats.map((s) => s.access).sort(), ['companion', 'space']);
});

test('the home page skips days where every showing has started', async () => {
  const { firstBookableDay, upcomingDays } = await import('../js/data.js');
  const lateNight = new Date(2026, 10, 12, 23, 30);
  const days = upcomingDays(6, lateNight);
  assert.equal(firstBookableDay(days, lateNight), days[1].key);
  const morning = new Date(2026, 10, 12, 9, 0);
  assert.equal(firstBookableDay(upcomingDays(6, morning), morning), days[0].key);
});

test('zooming keeps the point under your fingers where it is, and never leaves the map', async () => {
  const { zoomView, toMap, clampView, fitScale } = await import('../js/seatmap.js');
  const base = { x: -10, y: -1.3, w: 20, h: 12 };
  const rect = { left: 16, top: 400, width: 358, height: 214.8 }; // same shape as the map
  const close = (a, b) => Math.abs(a - b) < 1e-6;

  // zoom 1 is the whole map
  const full = zoomView(base, rect, 1, { x: 0, y: 0 }, 100, 500);
  assert.deepEqual(full, base);

  // pinch at a point in the middle: that map point stays under the same screen point
  const cx = 200;
  const cy = 520;
  const pt = toMap(rect, base, cx, cy);
  for (const z of [1.5, 2, 3.7]) {
    const v = zoomView(base, rect, z, pt, cx, cy);
    const back = toMap(rect, v, cx, cy);
    assert.ok(close(back.x, pt.x) && close(back.y, pt.y), `zoom ${z} drifted`);
    assert.ok(close(v.w, base.w / z) && close(v.h, base.h / z));
    assert.ok(close(fitScale(rect, v), fitScale(rect, base) * z));
  }

  // pinching in a corner can't pan past the edge of the map
  const corner = toMap(rect, base, rect.left + 2, rect.top + 2);
  const v = zoomView(base, rect, 3, corner, rect.left + 200, rect.top + 150);
  assert.ok(v.x >= base.x && v.y >= base.y);
  assert.ok(v.x + v.w <= base.x + base.w + 1e-9 && v.y + v.h <= base.y + base.h + 1e-9);

  // a view can't be bigger than the map, or sit outside it
  assert.deepEqual(clampView(base, { x: -50, y: 40, w: 99, h: 99 }), base);
  assert.deepEqual(clampView(base, { x: 5, y: 9, w: 10, h: 6 }), { x: 0, y: 4.7, w: 10, h: 6 });
});
