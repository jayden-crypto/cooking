// Demo data: one fictional cinema, its three screens, five made-up films and a week of
// showtimes. Occupancy is generated from the showtime id, so the same show always has the
// same seats taken (plus whatever you book yourself).

export const CINEMA = {
  name: 'The Lantern',
  area: 'Picturehouse · Canal Street',
};

export const AUDITORIUMS = {
  grand: {
    id: 'grand',
    name: 'Screen 1',
    format: 'Grand',
    screenWidth: 16,
    screenBottom: 1.4,
    curve: 2.2,
    rows: 13,
    blocks: [5, 12, 5],
    seatPitch: 0.6,
    rowPitch: 1.12,
    aisleWidth: 1.2,
    firstRow: 5.6,
    riser: 0.4,
    premiumRows: 3,
    prices: { standard: 14.5, premium: 18 },
  },
  studio: {
    id: 'studio',
    name: 'Screen 3',
    format: 'Studio',
    screenWidth: 11,
    screenBottom: 1.2,
    curve: 0,
    rows: 10,
    blocks: [4, 10, 4],
    seatPitch: 0.6,
    rowPitch: 1.08,
    aisleWidth: 1.1,
    firstRow: 4.2,
    riser: 0.34,
    premiumRows: 2,
    prices: { standard: 12.5, premium: 15.5 },
  },
  salon: {
    id: 'salon',
    name: 'Screen 5',
    format: 'Salon',
    style: 'recliner',
    screenWidth: 8.5,
    screenBottom: 1.1,
    curve: 0,
    rows: 6,
    blocks: [3, 6, 3],
    seatPitch: 0.95,
    rowPitch: 1.65,
    aisleWidth: 1.2,
    firstRow: 4,
    riser: 0.42,
    allPremium: true,
    prices: { standard: 19.5, premium: 19.5 },
  },
};

export const FILMS = [
  {
    id: 'long-quiet',
    title: 'The Long Quiet',
    scene: 'desert',
    genre: 'Drama',
    runtime: 134,
    rating: '12',
    blurb: 'A courier crosses an empty sea of sand with one message left to deliver.',
    popularity: 0.72,
  },
  {
    id: 'tidewater',
    title: 'Tidewater',
    scene: 'ocean',
    genre: 'Thriller',
    runtime: 112,
    rating: '15',
    blurb: 'The last keeper of a remote lighthouse sees a signal that shouldn’t be there.',
    popularity: 0.55,
  },
  {
    id: 'neon-hours',
    title: 'Neon Hours',
    scene: 'city',
    genre: 'Neo-noir',
    runtime: 123,
    rating: '15',
    blurb: 'One rain-soaked night, a cab driver picks up the wrong passenger.',
    popularity: 0.64,
  },
  {
    id: 'northbound',
    title: 'Northbound',
    scene: 'aurora',
    genre: 'Adventure',
    runtime: 107,
    rating: 'PG',
    blurb: 'Two sisters chase the northern lights to the end of the last road.',
    popularity: 0.4,
  },
  {
    id: 'perihelion',
    title: 'Perihelion',
    scene: 'space',
    genre: 'Sci-fi',
    runtime: 141,
    rating: '12',
    blurb: 'A salvage crew finds a ship that has been falling towards a giant for a thousand years.',
    popularity: 0.85,
  },
];

// Daily programme: [film, time, screen]. Each day gets the same grid; occupancy differs.
const PROGRAMME = [
  ['perihelion', '13:15', 'grand'],
  ['perihelion', '17:00', 'grand'],
  ['perihelion', '20:40', 'grand'],
  ['long-quiet', '14:30', 'studio'],
  ['long-quiet', '19:30', 'grand'],
  ['long-quiet', '21:10', 'salon'],
  ['neon-hours', '18:10', 'studio'],
  ['neon-hours', '22:15', 'studio'],
  ['tidewater', '16:20', 'salon'],
  ['tidewater', '20:00', 'studio'],
  ['northbound', '11:30', 'studio'],
  ['northbound', '15:45', 'grand'],
];

export function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function upcomingDays(count = 6, from = new Date()) {
  const days = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    days.push({
      key: dayKey(d),
      date: d,
      short: i === 0 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short' }),
      num: d.getDate(),
    });
  }
  return days;
}

export function showsFor(day) {
  return PROGRAMME.map(([film, time, screen]) => ({
    id: `${day}-${film}-${time.replace(':', '')}`,
    day,
    time,
    film: FILMS.find((f) => f.id === film),
    aud: AUDITORIUMS[screen],
  }));
}

export function findShow(id) {
  const m = /^(\d{4}-\d{2}-\d{2})-[a-z][a-z-]*-\d{4}$/.exec(String(id));
  if (!m) return null;
  return showsFor(m[1]).find((s) => s.id === id) || null;
}

export function hasStarted(show, now = new Date()) {
  const [h, m] = show.time.split(':').map(Number);
  const [y, mo, d] = show.day.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m) < now;
}

/* Small seeded RNG so occupancy is stable per show. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = typeof seed === 'number' ? seed : hash(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which seats are already sold. Good seats and evening shows go first; people book in
 *  pairs and small groups, so taken seats come in clumps. */
export function takenSeats(show, layout) {
  const rand = rng(show.id);
  const hour = Number(show.time.slice(0, 2));
  const evening = hour >= 18 ? 0.18 : hour >= 15 ? 0.06 : -0.08;
  const fill = Math.min(0.82, Math.max(0.12, show.film.popularity * 0.6 + evening + (rand() - 0.5) * 0.2));
  const taken = new Set();
  const target = Math.round(layout.seats.length * fill);
  const order = layout.seats
    .map((s) => ({ s, w: s.metrics.score / 100 + rand() * 0.9 }))
    .sort((a, b) => b.w - a.w);
  for (const { s } of order) {
    if (taken.size >= target) break;
    if (taken.has(s.id)) continue;
    const group = 1 + Math.floor(rand() * rand() * 4); // mostly 1–2, sometimes 3–4
    const row = layout.rows[s.row].seats;
    const start = row.indexOf(s);
    for (let i = 0; i < group && start + i < row.length; i++) {
      if (row[start + i].block !== s.block) break;
      taken.add(row[start + i].id);
    }
  }
  return taken;
}

export function priceOf(seat, aud) {
  return seat.premium ? aud.prices.premium : aud.prices.standard;
}

export function seatType(seat, aud) {
  if (aud.style === 'recliner') return 'Recliner';
  return seat.premium ? 'Premium' : 'Standard';
}

export const money = (n) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(n);

export function formatRuntime(min) {
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}
