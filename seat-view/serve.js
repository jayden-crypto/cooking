// Local server for trying the app on your computer: `npm run dev` (http://localhost:3001).
// The app is plain static files; any static server works.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const port = Number(process.env.PORT) || 3001;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const file = normalize(join(root, decodeURIComponent(pathname.endsWith('/') ? `${pathname}index.html` : pathname)));
  if (!file.startsWith(root) || file.split(sep).includes('node_modules')) return res.writeHead(404).end('Not found');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Sightline running at http://localhost:${port}`));
