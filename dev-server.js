// Local server for trying the app on your computer: `npm run dev`.
// Serves public/ and runs the same api/ handlers that Vercel runs in production.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — that's fine.
}

const root = fileURLToPath(new URL('./public/', import.meta.url));
const port = Number(process.env.PORT) || 3000;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    const api = pathname.match(/^\/api\/([a-z-]+)$/);
    if (api) {
      const { default: handler } = await import(`./api/${api[1]}.js`);
      return await handler(req, res);
    }
    const file = normalize(join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
    if (!file.startsWith(root)) throw Object.assign(new Error('forbidden'), { code: 'ENOENT' });
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND') {
      res.writeHead(404).end('Not found');
    } else {
      console.error(err);
      res.writeHead(500).end('Server error');
    }
  }
}).listen(port, () => console.log(`Recipe Box running at http://localhost:${port}`));
