# Recipe Box

My personal app for recipes I find on Instagram. Copy a post's link, open the app, tap **Paste link & save**, and it stores:

- the **thumbnail** (kept on the phone, so it doesn't vanish when Instagram's image links expire)
- the **creator** (@handle, profile picture and a link to their profile)
- the **recipe**, read from the caption: grouped ingredients, numbered steps, prep/cook time, servings, notes and tags
- the full original caption, plus a button to jump back to the reel

While cooking you can tick off ingredients and steps, keep the screen on, mark a recipe as made, favourite it and write your own notes. Search covers dish names, ingredients and creators.

TikTok, YouTube and recipe websites work too. Most recipe blogs publish structured recipe data, so those come through complete.

## Put it on your phone

The app is a website you add to your home screen. It needs a small server to read Instagram links, and [Vercel](https://vercel.com)'s free plan is the easiest place to run it. You can do all of this from your phone's browser.

1. Sign in at [vercel.com](https://vercel.com) with your GitHub account.
2. **Add New → Project**, pick this repository (`cooking`) and press **Deploy**. Nothing else needs configuring.
3. Open the address Vercel gives you (like `https://cooking-xyz.vercel.app`) on your phone:
   - **iPhone:** in Safari tap **Share → Add to Home Screen**.
   - **Android:** in Chrome tap **⋮ → Add to Home screen / Install app**.
4. Open **Recipes** from your home screen and save your first link.

On Android, once it's installed, **Recipes** also shows up in Instagram's share menu (Share → Recipes), so you don't even need to copy the link.

### Optional: better recipe reading with Claude

The built-in reader handles the usual caption formats (ingredient lists, "Method:", numbered steps, "SAUCE:" groups). To have Claude clean up messy captions as well (proper dish names, grouping, tags), add an Anthropic API key in Vercel under **Settings → Environment Variables**:

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | your key from [console.anthropic.com](https://console.anthropic.com) |
| `CLAUDE_MODEL` | optional; defaults to `claude-opus-5-5` |

Then redeploy (**Deployments → ⋯ → Redeploy**). **Settings** in the app shows whether the AI reader is on. If the AI step fails, the app falls back to the built-in reader.

### Optional: lock it with a password

Anyone who finds your Vercel address could use your link reader, and with an API key set, that could cost you money. Add an `APP_PASSWORD` environment variable in Vercel, redeploy, then enter the same password once in the app's **Settings**.

## Good to know

- **Your recipes live on your phone**, in the app's own storage. They work offline in the kitchen. Use **Settings → Save a backup** now and then (it can go to Files/iCloud/Drive) and **Restore** to move them to a new phone.
- On iPhone, the home-screen app and Safari keep **separate** storage. Always open the app from the home-screen icon.
- Some creators don't write the recipe in the caption. They say it in the video, or say "comment RECIPE" and DM it. The app still saves the post, tells you there's no written recipe, and gives you **Write it in** so you can type it yourself.
- Private posts can't be read. If Instagram blocks a request, the link is still saved: tap the card and use **Try again**, or write the recipe in yourself.
- Instagram can change its pages at any time. If saving starts failing for every post, the Instagram reader (`lib/instagram.js`) probably needs updating.

## Working on it

```bash
npm install
npm run dev          # http://localhost:3000 (reads .env if present, see .env.example)
npm test             # parser, Instagram reader, web reader, AI request shape
npm run try -- <link>   # print what the app would save for a link
```

| Path | What it does |
| --- | --- |
| `public/` | The app: `index.html`, `app.js` (UI), `db.js` (on-phone storage), `sw.js` (offline), styles, icons |
| `api/extract.js` | `GET /api/extract?url=…` returns thumbnail, creator, caption and recipe |
| `api/status.js` | Shows which optional features are on |
| `lib/instagram.js` | Reads public posts and reels through Instagram's embed page |
| `lib/caption-parser.js` | Built-in caption-to-recipe reader |
| `lib/ai.js` | Optional Claude recipe cleanup |
| `lib/web.js` | TikTok/YouTube (oEmbed) and recipe websites (schema.org data) |
| `lib/http.js` | Outbound fetches with timeouts, size limits and blocking of private addresses |
