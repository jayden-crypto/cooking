// Quick check from the terminal: `npm run try -- https://www.instagram.com/reel/XXXX/`
// Prints what the app would save (images shortened).

import { extractFromLink } from '../lib/extract.js';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — that's fine.
}

const link = process.argv[2];
if (!link) {
  console.error('Usage: npm run try -- <link>');
  process.exit(1);
}

const data = await extractFromLink(link);
const short = (v) => (v ? `${v.slice(0, 40)}… (${Math.round(v.length / 1024)} KB)` : v);
console.log(JSON.stringify({ ...data, thumbnail: short(data.thumbnail), author: { ...data.author, avatar: short(data.author.avatar) } }, null, 2));
