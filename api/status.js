// GET /api/status -> which optional features are switched on (shown in Settings).

import { aiEnabled } from '../lib/ai.js';
import { isAuthorized, sendJson } from '../lib/auth.js';

export default function handler(req, res) {
  sendJson(res, 200, {
    ok: true,
    ai: aiEnabled(),
    passwordRequired: Boolean(process.env.APP_PASSWORD),
    passwordAccepted: isAuthorized(req),
  });
}
