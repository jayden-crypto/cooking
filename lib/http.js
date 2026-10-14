// Small fetch helpers for talking to other websites from the server.
// Every outbound request goes through safeFetch, which refuses private/internal
// addresses (so the API can't be used to poke at internal networks), follows
// redirects by hand so each hop is checked, and caps time and size.

import dns from 'node:dns/promises';
import net from 'node:net';

export const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// Instagram serves the full server-rendered embed (caption, image, creator) to link-preview crawlers.
export const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

export class FetchError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublicUrl(url) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new FetchError('Only http(s) links are supported', 400);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new FetchError('That address is not allowed', 400);
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new FetchError(`Couldn't find ${host}`, 400);
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new FetchError('That address is not allowed', 400);
  }
}

/**
 * fetch() with SSRF protection, manual redirect checks and a timeout.
 * Returns the Response of the final hop; `response.finalUrl` holds its URL.
 * With maxRedirects: 0 a redirect response is returned as-is (read its Location header).
 */
export async function safeFetch(input, { headers = {}, timeoutMs = 12000, maxRedirects = 5 } = {}) {
  let url = new URL(input);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= Math.max(maxRedirects, 0); hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      headers: { 'accept-language': 'en-US,en;q=0.9', ...headers },
      redirect: 'manual',
      signal,
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location && maxRedirects > 0) {
      await res.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    res.finalUrl = url.toString();
    return res;
  }
  throw new FetchError('Too many redirects', 502);
}

async function readCapped(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchError('Response too large', 502);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function fetchText(url, { headers, maxBytes = 5_000_000, timeoutMs } = {}) {
  const res = await safeFetch(url, { headers, timeoutMs });
  if (!res.ok) {
    await res.body?.cancel();
    throw new FetchError(`The site answered with HTTP ${res.status}`, res.status === 404 ? 404 : 502);
  }
  const buf = await readCapped(res, maxBytes);
  return { text: buf.toString('utf8'), finalUrl: res.finalUrl };
}

export async function fetchJson(url, opts) {
  const { text } = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new FetchError('Unexpected response from the site', 502);
  }
}

/** Downloads an image and returns it as a data: URL (or null if anything goes wrong). */
export async function fetchImageAsDataUrl(url, { maxBytes = 8_000_000 } = {}) {
  if (!url) return null;
  try {
    const res = await safeFetch(url, { headers: { 'user-agent': BROWSER_UA }, timeoutMs: 10000 });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok || !type.startsWith('image/')) {
      await res.body?.cancel();
      return null;
    }
    const buf = await readCapped(res, maxBytes);
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
