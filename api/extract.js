// GET /api/extract?url=<link>  ->  thumbnail, creator, caption and recipe for that link.

import { isAuthorized, sendJson } from '../lib/auth.js';
import { extractFromLink } from '../lib/extract.js';
import { FetchError } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: 'This app is password protected. Enter the app password in Settings.', needsPassword: true });
  }

  const link = new URL(req.url, 'http://localhost').searchParams.get('url') || '';
  try {
    sendJson(res, 200, await extractFromLink(link));
  } catch (err) {
    if (err instanceof FetchError) return sendJson(res, err.status || 502, { error: err.message });
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return sendJson(res, 504, { error: 'The site took too long to answer. Try again in a moment.' });
    }
    console.error(err);
    sendJson(res, 500, { error: 'Something went wrong while reading that link.' });
  }
}
