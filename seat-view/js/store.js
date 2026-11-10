// Bookings and a couple of preferences, kept in this browser only. Every access is
// wrapped: private windows and blocked storage just mean nothing is remembered.

const KEY = 'sightline.bookings.v1';
const PREFS = 'sightline.prefs.v1';
const MAX_BOOKINGS = 12;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function bookings() {
  const list = read(KEY, []);
  return Array.isArray(list) ? list : [];
}

export function booking(id) {
  return bookings().find((b) => b.id === id) || null;
}

/** Seats you've booked for a show, so they show up as yours. */
export function mySeats(showId) {
  const set = new Set();
  for (const b of bookings()) if (b.showId === showId) b.seats.forEach((s) => set.add(s));
  return set;
}

export function addBooking(entry) {
  const list = [entry, ...bookings()].slice(0, MAX_BOOKINGS);
  if (write(KEY, list)) return true;
  // probably out of space: drop the view snapshots and try again
  return write(
    KEY,
    list.map((b, i) => (i === 0 ? b : { ...b, snapshot: null })),
  ) || write(KEY, [{ ...entry, snapshot: null }]);
}

export function removeBooking(id) {
  write(KEY, bookings().filter((b) => b.id !== id));
}

export function prefs() {
  return { people: true, heat: false, hintSeen: false, ...read(PREFS, {}) };
}

export function setPref(name, value) {
  write(PREFS, { ...prefs(), [name]: value });
}

export function newRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) ref += chars[b % chars.length];
  return `${ref.slice(0, 3)}-${ref.slice(3)}`;
}
