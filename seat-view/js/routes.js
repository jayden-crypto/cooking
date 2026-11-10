// Page addresses. Kept to letters, digits and hyphens (e.g. #show-2026-11-12-tidewater-2000-seat-F8)
// so they survive being shared, bookmarked or embedded anywhere.

const SHOW = '\\d{4}-\\d{2}-\\d{2}-[a-z][a-z-]*?-\\d{4}';
const SEAT = '[A-Z]\\d{1,2}';

export const routes = {
  home: () => '#home',
  show: (id, seat) => `#show-${id}${seat ? `-seat-${seat}` : ''}`,
  checkout: (id, seats) => `#checkout-${id}-seats-${seats.join('-')}`,
  ticket: (ref) => `#ticket-${ref}`,
};

export function parseRoute(hash) {
  const h = String(hash || '').replace(/^#/, '');
  let m = new RegExp(`^show-(${SHOW})(?:-seat-(${SEAT}))?$`).exec(h);
  if (m) return { page: 'show', id: m[1], seat: m[2] || null };
  m = new RegExp(`^checkout-(${SHOW})-seats-(${SEAT}(?:-${SEAT})*)$`).exec(h);
  if (m) return { page: 'checkout', id: m[1], seats: m[2].split('-') };
  m = /^ticket-([A-Z0-9]+(?:-[A-Z0-9]+)*)$/.exec(h);
  if (m) return { page: 'ticket', ref: m[1] };
  return { page: 'home' };
}
