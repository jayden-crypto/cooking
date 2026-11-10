// Sightline: pick a showtime, look from any seat in 3D, book it.
// Views: home, seat picker, review and ticket. Addresses are built in routes.js.

import {
  CINEMA,
  FILMS,
  upcomingDays,
  showsFor,
  findShow,
  hasStarted,
  takenSeats,
  priceOf,
  seatType,
  money,
  formatRuntime,
  dayKey,
  priceFrom,
  firstBookableDay,
} from './data.js';
import { buildLayout, bestSeat, describeView, formatOffset, formatClearance, seatGroups, groupAround } from './layout.js';
import { drawPoster } from './films.js';
import { SeatMap } from './seatmap.js';
import { routes, parseRoute } from './routes.js';
import * as store from './store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICON = {
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17h.01"/></svg>',
  aisle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v18M16 3v18M12 6v2M12 11v2M12 16v2"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  access: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4.4" r="2"/><path d="M11.5 8.5v5.5h5.5l2.6 5.6"/><path d="M8.6 11.2a5.6 5.6 0 1 0 7.4 7.4"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2.2"/></svg>',
};

const MAX_SEATS = 8;
const desktop = window.matchMedia('(min-width: 860px)');

/* ---------- state ---------- */

const layouts = new Map();
function layoutFor(aud) {
  if (!layouts.has(aud.id)) layouts.set(aud.id, buildLayout(aud));
  return layouts.get(aud.id);
}

const state = {
  day: firstBookableDay(upcomingDays(6)),
  show: null,
  layout: null,
  taken: new Set(),
  mine: new Set(),
  focus: null,
  bestCycle: null,
  prefs: store.prefs(),
  party: 1,
  snapshot: null,
  justBooked: null,
};

const views = ['home', 'seats', 'checkout', 'ticket'].reduce((o, id) => ({ ...o, [id]: document.getElementById(id) }), {});

function showView(id) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== id;
  document.body.classList.toggle('locked', id === 'seats');
  if (id !== 'seats') {
    closeViews({ restoreFocus: false });
    if (theater?.tiltOn) {
      theater.setTilt(false);
      setTiltUi(false);
    }
    theater?.stop();
  }
}

function go(hash, { replace = false } = {}) {
  if (replace) location.replace(hash);
  else location.hash = hash;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

function dayLabel(key) {
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 864e5));
  if (key === today) return 'Today';
  if (key === tomorrow) return 'Tomorrow';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

const seatName = (s) => `Row ${s.rowLabel}, Seat ${s.number}`;

function occupancy(show) {
  const layout = layoutFor(show.aud);
  const taken = takenSeats(show, layout);
  for (const id of store.mySeats(show.id)) taken.add(id);
  return { layout, taken };
}

/* ---------- home ---------- */

function renderHome() {
  const days = upcomingDays(6);
  if (!days.some((d) => d.key === state.day)) state.day = days[0].key;
  const shows = showsFor(state.day);
  const today = dayKey(new Date());
  const tickets = store.bookings().filter((b) => {
    const show = findShow(b.showId);
    return show && show.day >= today;
  });

  views.home.innerHTML = `
    <header class="home-top">
      <div class="brand"><img class="brand-mark" src="icons/icon.svg" alt="" /> Sightline</div>
      <div class="cinema">${ICON.pin}${esc(CINEMA.name)}</div>
    </header>
    <div class="hero">
      <h1>See the view<br />before you book.</h1>
      <p>Pick a showtime, then look at the screen from <b>any seat</b> in the room — in 3D, with the people already sitting there.</p>
    </div>
    <nav class="days" aria-label="Choose a day">
      ${days
        .map(
          (d) =>
            `<button class="day" data-day="${d.key}" aria-pressed="${d.key === state.day}">${esc(d.short)}<b>${d.num}</b></button>`,
        )
        .join('')}
    </nav>
    ${
      tickets.length
        ? `<h2 class="section-title">Your tickets</h2>
           <div class="my-tickets">${tickets.map(ticketChip).join('')}</div>`
        : ''
    }
    <h2 class="section-title">Now showing <span>${esc(dayLabel(state.day))}</span></h2>
    <div class="films">
      ${FILMS.map((film) => filmCard(film, shows.filter((s) => s.film.id === film.id))).join('')}
    </div>
    <p class="foot-note">A design prototype. The cinema, films and audience are made up, and no payment is ever taken.</p>`;

  views.home.querySelectorAll('canvas[data-scene]').forEach((c) => drawPoster(c.dataset.scene, c));
}

function filmCard(film, shows) {
  const times = shows
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((show) => {
      const { layout, taken } = occupancy(show);
      const pct = taken.size / layout.seats.length;
      const started = hasStarted(show);
      const cls = pct > 0.9 ? 'full' : pct > 0.7 ? 'busy' : '';
      const note = started ? 'Started' : pct > 0.9 ? 'Almost full' : `${show.aud.tag} · ${money(priceFrom(show.aud))}`;
      return `<button class="time ${cls}" data-show="${show.id}" ${started ? 'disabled' : ''}
          aria-label="${show.time}, ${esc(show.aud.name)}, ${esc(show.aud.tag)}, from ${money(priceFrom(show.aud))}, ${Math.round(pct * 100)}% sold">
          <b>${show.time}</b><span>${esc(note)}</span><i style="--fill:${Math.round(pct * 100)}%"></i></button>`;
    })
    .join('');
  return `
    <article class="film">
      <div class="film-still"><canvas data-scene="${film.scene}" width="960" height="402" aria-hidden="true"></canvas>
        <span class="rating" aria-label="Rated ${esc(film.rating)}">${esc(film.rating)}</span></div>
      <div class="film-body">
        <h2>${esc(film.title)}</h2>
        <p class="meta">${esc(film.genre)} · ${formatRuntime(film.runtime)}</p>
        <p class="blurb">${esc(film.blurb)}</p>
        <div class="times">${times}</div>
      </div>
    </article>`;
}

function ticketChip(b) {
  const show = findShow(b.showId);
  return `<button class="mini-ticket" data-ticket="${esc(b.id)}">
      ${b.snapshot ? `<img src="${b.snapshot}" alt="" />` : `<canvas data-scene="${show.film.scene}" width="128" height="128"></canvas>`}
      <div><strong>${esc(show.film.title)}</strong>
      <span>${esc(dayLabel(show.day))} · ${show.time}</span>
      <span>${b.seats.length > 1 ? 'Seats' : 'Seat'} ${esc(b.seats.join(', '))}</span></div>
    </button>`;
}

views.home.addEventListener('click', (e) => {
  const day = e.target.closest('[data-day]');
  if (day) {
    state.day = day.dataset.day;
    renderHome();
    return;
  }
  const time = e.target.closest('[data-show]');
  if (time && !time.disabled) {
    go(routes.show(time.dataset.show));
    return;
  }
  const ticket = e.target.closest('[data-ticket]');
  if (ticket) go(routes.ticket(ticket.dataset.ticket));
});

/* ---------- the 3D view (loaded on first use; three.js is the big download) ---------- */

let theater = null;
let theaterLoad = null;

function getTheater() {
  if (theaterLoad) return theaterLoad;
  theaterLoad = import('./theater.js')
    .then(({ Theater, webglAvailable }) => {
      if (!webglAvailable()) throw new Error('no webgl');
      theater = new Theater($('#stage'));
      theater.onFrame = syncRegion;
      theater.onLook = () => {
        hideHint();
        if (!state.prefs.hintSeen) {
          state.prefs.hintSeen = true;
          store.setPref('hintSeen', true);
        }
      };
      theater.onFirstFrame = () => {
        $('#stage-loading').hidden = true;
        maybeHint();
      };
      theater.onContextLost = () => {
        $('#stage-loading').hidden = false;
        $('#stage-loading p').lastChild.textContent = 'Restarting the 3D view';
      };
      theater.onContextRestored = () => ($('#stage-loading').hidden = true);
      theater.setPeople(state.prefs.people);
      return theater;
    })
    .catch((err) => {
      console.warn('3D view unavailable', err);
      $('#stage-loading').hidden = true;
      $('#stage-fallback').hidden = false;
      return null;
    });
  return theaterLoad;
}

let lastHintTop = -1;
function syncRegion() {
  const { w, h } = theater.size;
  let region;
  let ref;
  if (desktop.matches) {
    const sheetW = $('#sheet').offsetWidth;
    region = { x: 0, y: 0, w: w - sheetW, h };
    ref = region;
  } else {
    const top = $('#sheet').getBoundingClientRect().top;
    region = { x: 0, y: 0, w, h: Math.max(80, top) };
    ref = { x: 0, y: 0, w, h: sheet.refTop || top };
  }
  theater.setRegion(region, ref);
  const hintTop = Math.round(region.h);
  if (hintTop !== lastHintTop) {
    lastHintTop = hintTop;
    views.seats.style.setProperty('--hint-top', `${hintTop}px`);
  }
}

let hintTimer;
function maybeHint() {
  if (!state.prefs.hintSeen && !views.seats.hidden) showHint();
}
function showHint() {
  const hint = $('#look-hint');
  hint.classList.remove('gone');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(hideHint, 5000);
}
function hideHint() {
  $('#look-hint').classList.add('gone');
}

/* ---------- the sheet (drag between the seat card and the full seat map) ---------- */

const sheet = {
  el: $('#sheet'),
  body: $('#sheet-body'),
  open: false,
  y: 0,
  peekY: 0,
  refTop: 0,

  measure({ animate = false, ref = false } = {}) {
    const bar = $('#action-bar').offsetHeight;
    this.el.style.setProperty('--bar-h', `${bar}px`);
    if (desktop.matches) {
      this.el.classList.add('open');
      return;
    }
    const h = this.el.offsetHeight;
    const end = $('#peek-end');
    const visible = $('#grip').offsetHeight + end.offsetTop + end.offsetHeight + bar - 6;
    this.peekY = Math.max(0, h - visible);
    // the zoom of the 3D view is fixed by where the collapsed sheet starts
    if (!this.open && (ref || !this.refTop)) this.refTop = window.innerHeight - visible;
    this.set(this.open ? 0 : this.peekY, animate);
  },

  set(y, animate) {
    this.y = y;
    this.el.classList.toggle('animating', !!animate);
    this.el.style.setProperty('--sheet-y', `${y}px`);
  },

  toggle(open) {
    if (desktop.matches) return;
    this.open = open;
    this.el.classList.toggle('open', open);
    $('#grip').setAttribute('aria-expanded', String(open));
    $('#grip b').textContent = open ? 'Hide seat map' : 'Show seat map';
    if (!open) this.body.scrollTop = 0;
    this.measure({ animate: true });
  },
};

function bindSheetDrag(handle) {
  let drag = null;
  let suppressClick = false;
  // Moves are tracked on the window while a drag is on, so the sheet keeps following a
  // mouse that leaves the handle; no pointer capture, so taps on buttons inside still work.
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dy) < 6) return;
      drag.moved = true;
    }
    let y = drag.start + dy;
    if (y < 0) y /= 3;
    if (y > sheet.peekY) y = sheet.peekY + (y - sheet.peekY) / 3;
    sheet.set(y, false);
    drag.samples.push({ y: e.clientY, t: e.timeStamp });
    if (drag.samples.length > 5) drag.samples.shift();
  };
  handle.addEventListener('pointerdown', (e) => {
    if (desktop.matches || e.button !== 0) return;
    drag = { id: e.pointerId, y0: e.clientY, start: sheet.y, moved: false, samples: [{ y: e.clientY, t: e.timeStamp }] };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    const d = drag;
    drag = null;
    if (!d.moved) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    const a = d.samples[0];
    const b = d.samples.at(-1);
    const v = (b.y - a.y) / Math.max(1, b.t - a.t);
    const open = v < -0.35 ? true : v > 0.35 ? false : sheet.y < sheet.peekY / 2;
    sheet.toggle(open);
  }
  handle.addEventListener(
    'click',
    (e) => {
      if (suppressClick) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );
}

bindSheetDrag($('#grip'));
bindSheetDrag($('#seat-head'));
$('#grip').addEventListener('click', () => sheet.toggle(!sheet.open));
// tabbing into the seat map while the card is down brings it up, so focus is never hidden
$('#map-block').addEventListener('focusin', () => {
  if (!sheet.open && !desktop.matches) sheet.toggle(true);
});
$('#mini-map').addEventListener('click', () => sheet.toggle(true));
window.addEventListener('resize', () => {
  if (!views.seats.hidden) sheet.measure({ ref: true });
});
desktop.addEventListener('change', () => {
  sheet.el.classList.toggle('open', desktop.matches || sheet.open);
  if (!views.seats.hidden) sheet.measure({ ref: true });
});

/* ---------- seat picker ---------- */

const bigMap = new SeatMap($('#map-svg'), {
  onPreview: (seat) => setFocus(seat, { scrub: true }),
  onPick: (seat) => pickSeat(seat),
});
const miniMap = new SeatMap($('#mini-svg'), { mini: true });

const isFree = (id) => !state.taken.has(id) || state.mine.has(id);
// seats you can still buy (your own bookings you can look from, but not buy again)
const isBuyable = (seat) => !state.taken.has(seat.id);
// wheelchair spaces stay out of "best seat" and group searches unless you start from one
const isGeneral = (seat) => isBuyable(seat) && seat.access !== 'space';
const middleOf = (group) => group.seats[Math.floor((group.seats.length - 1) / 2)];

async function openShow(showId, focusId) {
  const show = findShow(showId);
  if (!show) return go(routes.home(), { replace: true });
  const changed = state.show?.id !== show.id;
  closeViews({ restoreFocus: false });
  const { layout, taken } = occupancy(show);
  state.show = show;
  state.layout = layout;
  state.taken = taken;
  state.mine = store.mySeats(show.id);
  if (changed) {
    state.focus = null;
    state.bestCycle = null;
  }
  const requested = focusId && layout.byId.get(focusId);
  if (requested && isFree(requested.id)) state.focus = requested.id;
  if (!state.focus || !isFree(state.focus)) {
    // start where the best group for your party would sit
    const best = seatGroups(layout, state.party, isGeneral)[0];
    state.focus = (best ? middleOf(best) : bestSeat(layout, isGeneral) || layout.seats[0]).id;
  }

  showView('seats');
  $('#seats-film').textContent = show.film.title;
  $('#seats-when').textContent = `${dayLabel(show.day)} ${show.time} · ${show.aud.name}`;
  $('#lg-premium').hidden = !layout.seats.some((s) => s.premium) || show.aud.style === 'recliner';
  $('#people-btn').setAttribute('aria-pressed', String(state.prefs.people));
  $('#heat-toggle').checked = state.prefs.heat;
  if (bigMap.layout !== layout) {
    bigMap.render(layout);
    miniMap.render(layout);
  }
  lastStats = null;
  updateSeatInfo();
  updateMaps();
  updateActions();
  if (changed) {
    sheet.open = false;
    sheet.el.classList.remove('open');
    sheet.body.scrollTop = 0;
  }
  requestAnimationFrame(() => sheet.measure({ ref: true }));

  // while the 3D room loads, the film's poster stands in for it
  drawPoster(show.film.scene, $('#stage-fallback canvas'));
  if (!theater?.firstFrameDone) {
    drawPoster(show.film.scene, $('#stage-loading canvas'));
    $('#stage-loading').hidden = false;
  }
  const t = await getTheater();
  if (!t || views.seats.hidden || state.show !== show) return;
  // the fly-in from the back is an introduction: once per room is enough
  const roomChanged = t.layout !== layout;
  const firstVisit = !seenRooms.has(layout.aud.id);
  if (firstVisit) {
    seenRooms.add(layout.aud.id);
    t.resetFlight();
  }
  t.setShow({ layout, scene: show.film.scene, taken: audienceFor() });
  t.focusSeat(layout.byId.get(state.focus), { instant: roomChanged && !firstVisit });
  t.start();
  if (t.firstFrameDone) maybeHint();
}

const seenRooms = new Set();

/** Heads in the 3D room: everyone else who has bought a seat (not you or your group). */
function audienceFor() {
  const set = new Set();
  for (const id of state.taken) if (!state.mine.has(id)) set.add(id);
  return set;
}

function setFocus(seat, { scrub = false } = {}) {
  if (!seat || state.focus === seat.id) return;
  if (!isFree(seat.id)) return;
  state.focus = seat.id;
  state.bestCycle = null;
  theater?.focusSeat(seat, { quick: scrub });
  updateSeatInfo();
  updateMaps();
  updateActions();
}

function pickSeat(seat) {
  if (!isFree(seat.id)) {
    toast(`${seatName(seat)} is taken`);
    return;
  }
  setFocus(seat);
}

/* ---------- seats together: the group you'd book, kept around the seat you look from ---------- */

function currentGroup() {
  const focus = state.layout.byId.get(state.focus);
  if (!focus || state.mine.has(focus.id)) return null;
  return groupAround(state.layout, focus, state.party, focus.access === 'space' ? isBuyable : isGeneral);
}

function setParty(n) {
  const next = Math.max(1, Math.min(MAX_SEATS, n));
  if (next === state.party) return;
  state.party = next;
  state.bestCycle = null;
  updateMaps();
  updateActions();
}

$('#party-minus').addEventListener('click', () => setParty(state.party - 1));
$('#party-plus').addEventListener('click', () => setParty(state.party + 1));

function updateMaps() {
  const group = currentGroup();
  const s = {
    taken: state.taken,
    mine: state.mine,
    selected: new Set(group ? group.seats.map((x) => x.id) : []),
    focus: state.focus,
    heat: state.prefs.heat,
  };
  bigMap.update(s);
  miniMap.update({ ...s, heat: false });
}

let lastStats = null;
function updateSeatInfo() {
  const seat = state.layout.byId.get(state.focus);
  const m = seat.metrics;
  const aud = state.show.aud;
  const mine = state.mine.has(seat.id);
  const label = $('#seat-label');
  label.textContent = mine ? 'Your seat' : m.label;
  label.className = `seat-label ${mine ? 'great' : m.tone}`;
  $('#seat-title').textContent = seatName(seat);
  $('#seat-sub').textContent = `${seatType(seat, aud)} · ${money(priceOf(seat, aud))}`;

  const next = { dist: m.distance, fov: m.fov, off: m.offset };
  const from = lastStats || next;
  lastStats = next;
  tween(from, next, (v) => {
    $('#st-dist').textContent = `${v.dist.toFixed(1)} m`;
    $('#st-fov').textContent = `${Math.round(v.fov)}°`;
    const off = formatOffset(v.off);
    $('#st-off').textContent = off.value;
    $('#st-off-unit').textContent = formatOffset(next.off).unit;
  });

  $('#seat-note').textContent = describeView(m);
  const facts = [];
  const clear = m.clearance === null || m.clearance >= 0.06;
  facts.push(`<li class="${clear ? 'ok' : 'meh'}">${clear ? ICON.eye : ICON.warn}${esc(formatClearance(m.clearance))}</li>`);
  if (m.lookUp > 12) facts.push(`<li class="meh">${ICON.up}Looking up ${Math.round(m.lookUp)}°</li>`);
  if (seat.access === 'space') facts.push(`<li class="ok">${ICON.access}Step-free wheelchair space</li>`);
  else if (seat.access === 'companion') facts.push(`<li class="ok">${ICON.access}Companion seat, beside a wheelchair space</li>`);
  else if (seat.aisle) facts.push(`<li class="ok">${ICON.aisle}Aisle seat</li>`);
  if (seat.premium && aud.style !== 'recliner') facts.push(`<li class="ok">${ICON.star}Premium, extra legroom</li>`);
  if (aud.style === 'recliner') facts.push(`<li class="ok">${ICON.star}Fully reclining</li>`);
  $('#seat-facts').innerHTML = facts.join('');
  if (!views.seats.hidden) requestAnimationFrame(() => sheet.measure({ animate: true }));
}

let tweenRaf;
function tween(from, to, paint) {
  cancelAnimationFrame(tweenRaf);
  const start = performance.now();
  const dur = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420;
  const step = (now) => {
    const t = dur ? Math.min(1, (now - start) / dur) : 1;
    const k = 1 - Math.pow(1 - t, 3);
    const v = {};
    for (const key of Object.keys(to)) v[key] = from[key] + (to[key] - from[key]) * k;
    paint(v);
    if (t < 1) tweenRaf = requestAnimationFrame(step);
  };
  step(start);
}

const range = (seats) => (seats.length > 2 ? `${seats[0].id}–${seats.at(-1).id}` : seats.map((s) => s.id).join(' & '));

function updateActions() {
  const aud = state.show.aud;
  const focus = state.layout.byId.get(state.focus);
  const primary = $('#continue-btn');
  const summary = $('#sel-summary');
  const n = state.party;
  $('#party-count').textContent = String(n);
  $('#party-minus').disabled = n <= 1;
  $('#party-plus').disabled = n >= MAX_SEATS;
  $('#party').setAttribute('aria-label', `${n} ${n > 1 ? 'seats' : 'seat'}`);
  $('#best-btn-label').textContent =
    state.bestCycle?.party === n ? 'Next best' : n > 1 ? `Best ${n} together` : 'Best available';
  primary.disabled = false;

  if (state.mine.has(focus.id)) {
    $('#party').hidden = true;
    primary.textContent = 'See your ticket';
    primary.dataset.action = 'ticket';
    summary.innerHTML = `You’ve booked <b>${esc(focus.id)}</b> for this showing`;
  } else {
    $('#party').hidden = false;
    const group = currentGroup();
    primary.dataset.action = 'book';
    if (!group) {
      primary.disabled = true;
      primary.textContent = n > 1 ? `No ${n} seats together left` : 'Sold out';
      summary.innerHTML = n > 1 ? 'Try fewer seats, or another showing.' : '';
    } else {
      const total = group.seats.reduce((sum, x) => sum + priceOf(x, aud), 0);
      primary.textContent = n > 1 ? `Book ${n} together · ${money(total)}` : `Book this seat · ${money(total)}`;
      if (n === 1) summary.innerHTML = '';
      else if (group.moved) {
        summary.innerHTML = `${ICON.warn}<span>No ${n} free together at ${esc(focus.id)}. Nearest: <b>${esc(range(group.seats))}</b></span>
          <button class="link-inline" id="go-group">Look from there</button>`;
      } else {
        summary.innerHTML = `${ICON.check}<span>Together: <b>${esc(range(group.seats))}</b></span>`;
      }
      summary.classList.toggle('moved', !!group.moved);
    }
  }
  if (!views.seats.hidden) requestAnimationFrame(() => sheet.measure({ animate: true }));
}

$('#sel-summary').addEventListener('click', (e) => {
  if (!e.target.closest('#go-group')) return;
  const group = currentGroup();
  if (group) setFocus(middleOf(group));
});

$('#continue-btn').addEventListener('click', (e) => {
  const action = e.currentTarget.dataset.action;
  if (action === 'ticket') {
    const b = store.bookings().find((x) => x.showId === state.show.id && x.seats.includes(state.focus));
    if (b) go(routes.ticket(b.id));
    return;
  }
  const group = currentGroup();
  if (!group) return;
  const ids = group.seats.map((s) => s.id);
  // the ticket keeps a picture of the view from one of the seats you're buying
  if (theater && !ids.includes(state.focus)) {
    const seat = middleOf(group);
    theater.focusSeat(seat, { instant: true });
    state.focus = seat.id;
  }
  state.snapshot = theater ? safe(() => theater.snapshot()) : null;
  state.snapshotSeat = state.focus;
  go(routes.checkout(state.show.id, ids));
});

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

$('#seats-back').addEventListener('click', () => go(routes.home()));
// best group for your party; tap again for the next best
$('#best-btn').addEventListener('click', () => {
  const n = state.party;
  const groups = seatGroups(state.layout, n, isGeneral);
  if (!groups.length) {
    toast(n > 1 ? `No ${n} seats together left for this showing` : 'This showing is sold out');
    return;
  }
  const index = state.bestCycle?.party === n ? (state.bestCycle.index + 1) % groups.length : 0;
  const g = groups[index];
  setFocus(middleOf(g));
  state.bestCycle = { party: n, index };
  const what = n > 1 ? `${n} together: ${range(g.seats)}` : `free seat: ${g.seats[0].id}`;
  toast(index === 0 ? `Best ${what}` : `Option ${index + 1} of ${groups.length}: ${range(g.seats)}`);
  updateMaps();
  updateActions();
});
// tilt the phone to look around: offered on touch devices that have a motion sensor API
const tiltBtn = $('#tilt-btn');
tiltBtn.hidden = !('DeviceOrientationEvent' in window && window.matchMedia('(pointer: coarse)').matches);
let tiltCheck;
// inside another page (like a preview frame) the browser blocks motion sensors entirely
const embedded = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
const TILT_BLOCKED_HERE = 'Tilt is blocked inside this preview. Open the app on its own site to use it.';
function setTiltUi(on) {
  tiltBtn.setAttribute('aria-pressed', String(on));
  tiltBtn.setAttribute('aria-label', on ? 'Stop looking around with your phone' : 'Look around by moving your phone');
}
tiltBtn.addEventListener('click', async () => {
  if (theater?.tiltOn) {
    theater.setTilt(false);
    setTiltUi(false);
    toast('Tilt off. Drag to look around');
    return;
  }
  // iPhone asks first, and only straight from a tap, so this comes before anything else
  const ask = window.DeviceOrientationEvent?.requestPermission;
  if (typeof ask === 'function') {
    let answer = 'denied';
    try {
      answer = await ask.call(window.DeviceOrientationEvent);
    } catch {
      answer = 'denied';
    }
    if (answer !== 'granted') {
      toast(embedded ? TILT_BLOCKED_HERE : 'Motion access is off. If you tapped Don’t Allow, reload the page and allow it.');
      return;
    }
  }
  const t = await getTheater();
  if (!t) return;
  t.setTilt(true);
  setTiltUi(true);
  toast('Move your phone to look around. Double-tap to re-centre.');
  clearTimeout(tiltCheck);
  tiltCheck = setTimeout(() => {
    if (t.tiltOn && !t.lastOrientation) {
      t.setTilt(false);
      setTiltUi(false);
      toast(embedded ? TILT_BLOCKED_HERE : 'This device isn’t sending motion data, so drag to look around instead');
    }
  }, 1500);
});

$('#people-btn').addEventListener('click', (e) => {
  state.prefs.people = !state.prefs.people;
  store.setPref('people', state.prefs.people);
  e.currentTarget.setAttribute('aria-pressed', String(state.prefs.people));
  theater?.setPeople(state.prefs.people);
  toast(state.prefs.people ? 'Showing the audience' : 'Empty room');
});
$('#heat-toggle').addEventListener('change', (e) => {
  state.prefs.heat = e.target.checked;
  store.setPref('heat', state.prefs.heat);
  updateMaps();
});

// keyboard on the seat map: arrows move between free seats
$('#seat-map').addEventListener('keydown', (e) => {
  const layout = state.layout;
  const seat = layout.byId.get(state.focus);
  const row = layout.rows[seat.row];
  let next = null;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    let i = row.seats.indexOf(seat) + dir;
    while (row.seats[i] && !isFree(row.seats[i].id)) i += dir;
    next = row.seats[i];
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const dir = e.key === 'ArrowUp' ? -1 : 1;
    for (let r = seat.row + dir; r >= 0 && r < layout.rows.length && !next; r += dir) {
      const options = layout.rows[r].seats.filter((s) => isFree(s.id));
      next = options.sort((a, b) => Math.abs(a.arc - seat.arc) - Math.abs(b.arc - seat.arc))[0] || null;
    }
  } else {
    return;
  }
  e.preventDefault();
  if (next) setFocus(next);
});

/* ---------- compare views: the view from the left, centre and right of every row ---------- */

const POSITIONS = ['Left', 'Centre', 'Right'];

/** Three seats per row: the middle of each side block and the centre of the middle block,
 *  moved to the nearest free seat where there is one. If you're sitting in this row, your
 *  seat stands in for its block. */
function sampleRow(row) {
  const blocks = [...new Set(row.seats.map((s) => s.block))];
  const byDistance = (list, arc) => [...list].sort((a, b) => Math.abs(a.arc - arc) - Math.abs(b.arc - arc));
  const nearest = (list, arc) => {
    const sorted = byDistance(list, arc);
    return sorted.find((s) => isFree(s.id)) || sorted[0] || null;
  };
  let picks;
  if (blocks.length === 3) {
    picks = blocks.map((b, i) => {
      const list = row.seats.filter((s) => s.block === b);
      return nearest(list, i === 1 ? 0 : list[Math.floor(list.length / 2)].arc);
    });
  } else {
    const first = row.seats[0].arc;
    const span = row.seats.at(-1).arc - first;
    picks = [0.12, 0.5, 0.88].map((t) => nearest(row.seats, first + span * t));
    picks = picks.map((s, i) => (picks.indexOf(s) === i ? s : null));
  }
  const focus = state.layout.byId.get(state.focus);
  if (focus?.row === row.index) {
    const i = picks.findIndex((s) => s && s.block === focus.block);
    if (i >= 0) picks[i] = focus;
  }
  return picks;
}

function viewCard(seat, position) {
  if (!seat) return `<div class="view-card empty"><span>No seat here</span></div>`;
  const m = seat.metrics;
  const mine = state.mine.has(seat.id);
  const sold = !isFree(seat.id);
  const label = mine ? 'Yours' : sold ? 'Taken' : m.label;
  const tone = mine ? 'great' : sold ? 'sold' : m.tone;
  return `<button class="view-card${seat.id === state.focus ? ' current' : ''}${sold ? ' sold' : ''}" data-seat="${seat.id}"
      aria-label="${position}: ${esc(seatName(seat))}, ${esc(label)}${sold ? '' : `, ${Math.round(m.fov)}° field of view`}">
      <canvas data-seat="${seat.id}" aria-hidden="true"></canvas>
      <span class="vc-cap"><b>${seat.id}</b><i class="${tone}">${esc(label)}</i></span>
    </button>`;
}

async function openViews() {
  const layout = state.layout;
  const panel = $('#views');
  const grid = $('#views-grid');
  grid.innerHTML = layout.rows
    .map((row) => {
      const mid = row.seats[Math.floor(row.seats.length / 2)].metrics;
      return `<section class="views-row" aria-label="Row ${row.label}">
        <div class="views-row-head"><b>Row ${row.label}</b><span>${mid.distance.toFixed(1)} m to screen · ${Math.round(mid.fov)}°</span></div>
        <div class="views-cards">${sampleRow(row)
          .map((s, i) => viewCard(s, POSITIONS[i]))
          .join('')}</div>
      </section>`;
    })
    .join('');
  panel.hidden = false;
  panel.scrollTop = 0;
  document.addEventListener('keydown', onViewsKey);
  $('#views-close').focus({ preventScroll: true });
  // start with your own row in view (scroll the panel only, never the page behind it)
  const current = grid.querySelector('.view-card.current');
  if (current) {
    const offset = current.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    panel.scrollTop = Math.max(0, offset - panel.clientHeight / 2 + current.offsetHeight / 2);
  }

  const t = await getTheater();
  if (panel.hidden) return;
  const pr = t ? t.renderer.getPixelRatio() : Math.min(window.devicePixelRatio || 1, 2);
  const canvases = [...grid.querySelectorAll('canvas[data-seat]')];
  for (const c of canvases) {
    const w = c.clientWidth;
    c.width = Math.round(w * pr);
    c.height = Math.round((w / 1.45) * pr);
    if (!t) {
      drawPoster(state.show.film.scene, c);
      c.classList.add('ready');
    }
  }
  if (!t) return;
  // draw the rows you can see first, then the rest
  const top = panel.getBoundingClientRect().top;
  const jobs = canvases
    .map((c) => ({ c, d: Math.abs(c.getBoundingClientRect().top - top - panel.clientHeight / 3) }))
    .sort((a, b) => a.d - b.d)
    .map(({ c }) => ({
      seat: layout.byId.get(c.dataset.seat),
      canvas: c,
      hide: !isFree(c.dataset.seat),
      done: () => c.classList.add('ready'),
    }));
  t.queueViews(jobs);
}

function closeViews({ restoreFocus = true } = {}) {
  const panel = $('#views');
  if (panel.hidden) return;
  panel.hidden = true;
  theater?.clearViews();
  document.removeEventListener('keydown', onViewsKey);
  if (restoreFocus) $('#views-btn').focus({ preventScroll: true });
}

function onViewsKey(e) {
  if (e.key === 'Escape') closeViews();
}

$('#views-btn').addEventListener('click', openViews);
$('#views-close').addEventListener('click', () => closeViews());
$('#views-grid').addEventListener('click', (e) => {
  const card = e.target.closest('.view-card[data-seat]');
  if (!card) return;
  let seat = state.layout.byId.get(card.dataset.seat);
  if (!isFree(seat.id)) {
    const row = state.layout.rows[seat.row].seats.filter((s) => isFree(s.id));
    const nearest = row.sort((a, b) => Math.abs(a.arc - seat.arc) - Math.abs(b.arc - seat.arc))[0];
    if (!nearest) return toast(`Row ${seat.rowLabel} is sold out`);
    toast(`${seat.id} is taken, so here’s ${nearest.id}, the closest free seat`);
    seat = nearest;
  }
  closeViews({ restoreFocus: false });
  if (sheet.open) sheet.toggle(false);
  setFocus(seat);
});

/* ---------- review ---------- */

function renderCheckout(showId, ids) {
  const show = findShow(showId);
  if (!show) return go(routes.home(), { replace: true });
  const { layout, taken } = occupancy(show);
  const seats = ids.map((id) => layout.byId.get(id)).filter((s) => s && !taken.has(s.id));
  if (!seats.length) return go(routes.show(showId), { replace: true });
  const aud = show.aud;
  const total = seats.reduce((sum, s) => sum + priceOf(s, aud), 0);
  const viewSeat = layout.byId.get(state.snapshotSeat) || seats[0];
  const snap = state.show?.id === showId && state.snapshot;

  views.checkout.innerHTML = `
    <header class="page-top">
      <button class="glass-btn" id="co-back" aria-label="Back to seats">${ICON.back}</button>
      <h1>Review booking</h1>
    </header>
    <figure class="snap">
      ${snap ? `<img src="${snap}" alt="The view of the screen from ${esc(seatName(viewSeat))}" />` : `<canvas data-scene="${show.film.scene}" width="960" height="402"></canvas>`}
      <figcaption>Your view from ${esc(viewSeat.id)}</figcaption>
    </figure>
    <div class="card">
      <h2>${esc(show.film.title)}</h2>
      <p class="meta">${esc(dayLabel(show.day))} · ${show.time} · ${esc(aud.name)} · ${esc(aud.tag)}</p>
      <ul class="lines">
        ${seats
          .map(
            (s) => `<li><span>${esc(seatName(s))}<small>${esc(seatType(s, aud))} · ${esc(s.metrics.label)}</small></span>
              <span>${money(priceOf(s, aud))}</span></li>`,
          )
          .join('')}
        <li><span>Booking fee</span><span>${money(0)}</span></li>
        <li class="total"><span>Total</span><span>${money(total)}</span></li>
      </ul>
    </div>
    <p class="demo-note">This is a design prototype: nothing is charged and no real tickets are issued.</p>
    <button class="btn primary block" id="confirm-btn">Confirm booking</button>`;

  views.checkout.querySelector('canvas[data-scene]') && drawPoster(show.film.scene, views.checkout.querySelector('canvas'));
  $('#co-back').addEventListener('click', () => go(routes.show(showId)));
  $('#confirm-btn').addEventListener('click', () => {
    const entry = {
      id: store.newRef(),
      showId,
      seats: seats.map((s) => s.id),
      total,
      created: Date.now(),
      snapshot: snap || null,
      viewSeat: snap ? viewSeat.id : seats[0].id,
    };
    if (!store.addBooking(entry)) toast('Couldn’t save the ticket in this browser, but here it is');
    state.justBooked = entry;
    go(routes.ticket(entry.id), { replace: true });
  });
}

/* ---------- ticket ---------- */

function bars(ref) {
  let x = 0;
  let rects = '';
  for (const ch of `${ref}${ref}`) {
    const code = ch.charCodeAt(0);
    for (let k = 0; k < 3; k++) {
      const w = 1 + ((code >> k) & 1) * 1.5;
      rects += `<rect x="${x}" y="0" width="${w}" height="40" />`;
      x += w + 1 + ((code >> (k + 2)) & 1);
    }
  }
  return `<svg class="bars" viewBox="0 0 ${x} 40" preserveAspectRatio="none" aria-hidden="true" style="fill:#fff;stroke:none">${rects}</svg>`;
}

function renderTicket(id) {
  const b = store.booking(id) || (state.justBooked?.id === id ? state.justBooked : null);
  if (!b) {
    toast('That ticket isn’t saved in this browser');
    return go(routes.home(), { replace: true });
  }
  const show = findShow(b.showId);
  const layout = layoutFor(show.aud);
  const seats = b.seats.map((s) => layout.byId.get(s)).filter(Boolean);
  const fresh = state.justBooked?.id === id;
  const types = [...new Set(seats.map((s) => seatType(s, show.aud)))].join(', ');

  views.ticket.innerHTML = `
    <header class="page-top">
      <button class="glass-btn" id="tk-back" aria-label="Back to films">${ICON.back}</button>
      <h1>Your ticket</h1>
    </header>
    ${
      fresh
        ? `<div class="done-head"><div class="tick">${ICON.check}</div><h1>You’re booked</h1>
           <p>${esc(show.film.title)}, ${esc(dayLabel(show.day).toLowerCase() === 'today' ? 'today' : dayLabel(show.day))} at ${show.time}. Enjoy the view.</p></div>`
        : ''
    }
    <article class="stub">
      <figure class="snap">
        ${b.snapshot ? `<img src="${b.snapshot}" alt="The view from your seat" />` : `<canvas data-scene="${show.film.scene}" width="960" height="402"></canvas>`}
        <figcaption>Your view from ${esc(b.viewSeat || b.seats[0])}</figcaption>
      </figure>
      <div class="stub-body">
        <h2>${esc(show.film.title)}</h2>
        <div class="stub-grid">
          <div><span>Date</span><b>${esc(dayLabel(show.day))}</b></div>
          <div><span>Time</span><b>${show.time}</b></div>
          <div><span>Screen</span><b>${esc(show.aud.name.replace('Screen ', ''))} · ${esc(show.aud.tag)}</b></div>
          <div><span>${seats.length > 1 ? 'Seats' : 'Seat'}</span><b>${esc(b.seats.join(', '))}</b></div>
          <div><span>Type</span><b>${esc(types)}</b></div>
          <div><span>Paid</span><b>${money(b.total)}</b></div>
        </div>
      </div>
      <div class="perf"><i></i></div>
      <div class="stub-code">
        <div><span>Booking</span><b>${esc(b.id)}</b></div>
        ${bars(b.id)}
      </div>
    </article>
    <div class="page-actions">
      <button class="btn primary block" id="tk-view">${ICON.eye}See the view from my seat</button>
      <button class="btn block" id="tk-home">Back to films</button>
      <button class="link-btn" id="tk-cancel">Cancel this booking</button>
    </div>
    <p class="demo-note">Demo ticket. It won’t get you into a real cinema.</p>`;

  const c = views.ticket.querySelector('canvas[data-scene]');
  if (c) drawPoster(show.film.scene, c);
  $('#tk-back').addEventListener('click', () => go(routes.home()));
  $('#tk-home').addEventListener('click', () => go(routes.home()));
  $('#tk-view').addEventListener('click', () => go(routes.show(show.id, b.viewSeat || b.seats[0])));
  // two taps to cancel, so it can't happen by accident
  let armed = null;
  $('#tk-cancel').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (!armed) {
      btn.textContent = 'Tap again to cancel. The seats go back on sale.';
      btn.classList.add('armed');
      armed = setTimeout(() => {
        armed = null;
        btn.textContent = 'Cancel this booking';
        btn.classList.remove('armed');
      }, 4000);
      return;
    }
    clearTimeout(armed);
    store.removeBooking(b.id);
    if (state.justBooked?.id === b.id) state.justBooked = null;
    toast('Booking cancelled');
    go(routes.home(), { replace: true });
  });
}

/* ---------- routing ---------- */

function route() {
  const r = parseRoute(location.hash);
  if (r.page === 'show') {
    openShow(r.id, r.seat);
    return;
  }
  if (r.page === 'checkout') {
    showView('checkout');
    renderCheckout(r.id, r.seats);
  } else if (r.page === 'ticket') {
    showView('ticket');
    renderTicket(r.ref);
  } else {
    showView('home');
    renderHome();
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();

// start fetching three.js in the background once the home page is up
if ('requestIdleCallback' in window) requestIdleCallback(() => getTheater());
else setTimeout(() => getTheater(), 1500);
