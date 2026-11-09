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
