import { db, requestPersistentStorage } from './db.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const $ = (selector, root = document) => root.querySelector(selector);

/** Builds DOM nodes. Text is always inserted as text (never HTML), so captions can't inject markup. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const ICONS = {
  back: '<path d="m15 18-6-6 6-6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8Z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="m9 12.5 2 2 4-4.5"/>',
  bowl: '<path d="M3 11.5h18a9 9 0 0 1-18 0Z"/><path d="M8.5 8c0-1.6 1.2-1.6 1.2-3.2M12.5 8c0-1.6 1.2-1.6 1.2-3.2"/>',
  flame: '<path d="M12 21.5c3.9 0 6.8-2.6 6.8-6.5 0-3.3-2.3-5.8-4-7.6-.4 1.9-1.5 3.1-2.6 3.6.3-2.6-.6-5.5-2.9-7.5-.3 3.2-2 5.2-3.4 6.9C4.6 12 4.2 13.5 4.2 15c0 3.9 3.1 6.5 7.8 6.5Z"/>',
  caption: '<path d="M20.5 11.6a8.4 8.4 0 0 1-12.2 7.5L3.5 20.5l1.4-4.6a8.4 8.4 0 1 1 15.6-4.3Z"/>',
  arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>',
};

function icon(name, { filled = false } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  if (filled) svg.style.fill = 'currentColor';
  return svg;
}

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private mode — the value just won't be remembered.
    }
  },
};

const normalise = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const shorten = (text, max = 40) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "1 hr 10 min" -> 70, "15–20 min" -> 20. Returns null when there's no time in the text. */
function parseMinutes(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const hours = t.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hrs?|hours?)\b/);
  const mins = t.match(/(\d+)\s*(?:m|mins?|minutes?)\b/);
  if (!hours && !mins) return null;
  return Math.round((hours ? parseFloat(hours[1].replace(',', '.')) * 60 : 0) + (mins ? Number(mins[1]) : 0)) || null;
}

/** Total time for a recipe: its stated total, or prep + cook. */
function recipeMinutes(recipe = {}) {
  const total = parseMinutes(recipe.totalTime);
  if (total) return total;
  const sum = (parseMinutes(recipe.prepTime) || 0) + (parseMinutes(recipe.cookTime) || 0);
  return sum || null;
}

const shortTime = (minutes) =>
  minutes < 60 ? `${minutes}m` : minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;

const readyAt = (minutes) => new Date(Date.now() + minutes * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const formatDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function findUrl(text) {
  const full = String(text || '').match(/https?:\/\/[^\s<>"']+/i)?.[0];
  const bare = String(text || '').match(/\b(?:www\.)?(?:instagram\.com|instagr\.am|tiktok\.com|youtube\.com|youtu\.be)\/[^\s<>"']+/i)?.[0];
  const candidate = full || (bare && `https://${bare}`);
  if (!candidate) return null;
  try {
    return new URL(candidate.replace(/[),.!?]+$/, '')).toString();
  } catch {
    return null;
  }
}

/** Same post => same key, whatever tracking junk the share link carried. */
function linkKey(link) {
  if (!link) return '';
  const ig = link.match(/instagr(?:am\.com|\.am)\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]+)/i);
  if (ig) return `ig:${ig[1]}`;
  try {
    const url = new URL(link);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}${url.hostname.includes('youtube') ? url.searchParams.get('v') || '' : ''}`;
  } catch {
    return link;
  }
}

function sourceName(record) {
  switch (record.source) {
    case 'instagram':
      return 'Instagram';
    case 'tiktok':
      return 'TikTok';
    case 'youtube':
      return 'YouTube';
    default:
      try {
        return new URL(record.url).hostname.replace(/^www\./, '');
      } catch {
        return 'the web';
      }
  }
}

function guessSource(link) {
  if (/instagr/i.test(link)) return 'instagram';
  if (/tiktok\.com/i.test(link)) return 'tiktok';
  if (/youtu\.?be/i.test(link)) return 'youtube';
  return 'web';
}

function guessTitle(link) {
  if (/instagr/i.test(link)) return /\/reels?\//i.test(link) ? 'Instagram reel' : 'Instagram post';
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return 'New recipe';
  }
}

/** Shrinks images before storing them so hundreds of recipes stay light on the phone. */
async function shrinkImage(dataUrl, maxWidth, quality = 0.82) {
  if (!dataUrl) return null;
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', quality);
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = {
  recipes: [],
  query: '',
  filter: 'all',
  password: storage.get('appPassword'),
  openId: null,
  detailTab: 'recipe',
  cameFromList: false,
};

const byId = (id) => state.recipes.find((r) => r.id === id);

async function save(record, { rerender = true } = {}) {
  record.updatedAt = Date.now();
  await db.put(record);
  const i = state.recipes.findIndex((r) => r.id === record.id);
  if (i === -1) state.recipes.unshift(record);
  else state.recipes[i] = record;
  renderList();
  if (rerender && state.openId === record.id) renderDetail(record, { keepScroll: true });
}

async function removeRecipe(id) {
  await db.remove(id);
  state.recipes = state.recipes.filter((r) => r.id !== id);
  renderList();
}

/* ------------------------------------------------------------------ */
/* Talking to the server                                               */
/* ------------------------------------------------------------------ */

async function fetchRecipeData(link) {
  let res;
  try {
    res = await fetch(`/api/extract?url=${encodeURIComponent(link)}`, {
      headers: state.password ? { 'x-app-password': state.password } : {},
    });
  } catch {
    throw new Error("You're offline. Try again when you have signal.");
  }
  let body = {};
  try {
    body = await res.json();
  } catch {
    // Non-JSON error page
  }
  if (!res.ok) {
    const err = new Error(body.error || `The server had a problem (${res.status}).`);
    err.needsPassword = Boolean(body.needsPassword);
    throw err;
  }
  return body;
}

async function addLink(text) {
  const link = findUrl(text);
  if (!link) {
    toast("That doesn't look like a link. Copy the post's link in Instagram first.");
    return;
  }
  const key = linkKey(link);
  const existing = state.recipes.find((r) => linkKey(r.url) === key || linkKey(r.sourceUrl) === key);
  if (existing) {
    toast('Already in your recipe box', { action: 'Open', onAction: () => openRecipe(existing.id) });
    return;
  }
  const now = Date.now();
  const record = {
    id: crypto.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`,
    url: link,
    sourceUrl: link,
    source: guessSource(link),
    mediaType: /\/reels?\/|tiktok|youtu/i.test(link) ? 'video' : 'image',
    title: guessTitle(link),
    author: {},
    recipe: {},
    favorite: false,
    cookCount: 0,
    myNotes: '',
    checks: { ing: [], steps: [] },
    createdAt: now,
    updatedAt: now,
  };
  await loadIntoRecord(record);
}

/** Fetches (or re-fetches) a link and fills the record. Your notes, favourite and "made it" history are kept. */
async function loadIntoRecord(record) {
  record.pending = true;
  record.error = null;
  await save(record);
  try {
    const data = await fetchRecipeData(record.sourceUrl || record.url);
    if (!byId(record.id)) return; // deleted while it was loading
    const duplicate = state.recipes.find((r) => r.id !== record.id && linkKey(r.url) === linkKey(data.url));
    if (duplicate) {
      await removeRecipe(record.id);
      if (state.openId === record.id) location.replace(`#/r/${duplicate.id}`);
      toast('You already saved this one', { action: 'Open', onAction: () => openRecipe(duplicate.id) });
      return;
    }
    const [thumbnail, avatar] = await Promise.all([shrinkImage(data.thumbnail, 640, 0.78), shrinkImage(data.author?.avatar, 96)]);
    Object.assign(record, {
      url: data.url,
      source: data.source,
      mediaType: data.mediaType,
      title: data.title,
      author: { ...data.author, avatar },
      caption: data.caption,
      thumbnail: thumbnail || record.thumbnail || null,
      recipe: data.recipe,
      hasRecipe: data.hasRecipe,
      recipeSource: data.recipeSource,
      checks: { ing: [], steps: [] },
      edited: false,
      pending: false,
      error: null,
    });
    await save(record);
    if (state.openId !== record.id) {
      toast(`Saved “${shorten(record.title)}”`, { action: 'Open', onAction: () => openRecipe(record.id) });
    }
  } catch (err) {
    if (!byId(record.id)) return;
    record.pending = false;
    record.error = err.message;
    await save(record);
    if (err.needsPassword) toast('Enter your app password first', { action: 'Settings', onAction: openSettings });
    else if (state.openId !== record.id) toast("Couldn't read that link — the link is saved, tap it to retry.");
  }
}

/* ------------------------------------------------------------------ */
/* List view                                                           */
/* ------------------------------------------------------------------ */

function searchText(r) {
  return normalise(
    [
      r.title,
      r.author?.username,
      r.author?.name,
      ...(r.recipe?.tags || []),
      ...(r.recipe?.ingredients || []).flatMap((g) => g.items),
      r.caption,
      r.myNotes,
    ].join(' '),
  );
}

function topTags() {
  const counts = new Map();
  for (const r of state.recipes) for (const t of r.recipe?.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([t]) => t);
}

function visibleRecipes() {
  const words = normalise(state.query).split(/\s+/).filter(Boolean);
  return state.recipes.filter((r) => {
    if (state.filter === 'fav' && !r.favorite) return false;
    if (state.filter === 'totry' && r.cookCount > 0) return false;
    if (state.filter === 'made' && !(r.cookCount > 0)) return false;
    if (state.filter.startsWith('tag:') && !(r.recipe?.tags || []).includes(state.filter.slice(4))) return false;
    if (!words.length) return true;
    const text = searchText(r);
    return words.every((w) => text.includes(w));
  });
}

function renderFilters() {
  const nav = $('#filters');
  if (!state.recipes.length) {
    nav.replaceChildren();
    return;
  }
  const chips = [
    ['all', 'All'],
    ['fav', '♥ Favorites'],
    ['totry', 'To try'],
    ['made', 'Made it'],
    ...topTags().map((t) => [`tag:${t}`, `#${t}`]),
  ];
  // A tag picked from a recipe page stays visible even if only one recipe has it.
  if (state.filter.startsWith('tag:') && !chips.some(([id]) => id === state.filter)) {
    chips.push([state.filter, `#${state.filter.slice(4)}`]);
  }
  if (!chips.some(([id]) => id === state.filter)) state.filter = 'all';
  nav.replaceChildren(
    ...chips.map(([id, label]) =>
      h('button', {
        class: 'chip',
        'aria-pressed': String(state.filter === id),
        onclick: () => {
          state.filter = state.filter === id ? 'all' : id;
          renderList();
        },
      }, label),
    ),
  );
}

function avatarEl(author = {}) {
  if (author.avatar) return h('img', { class: 'avatar', src: author.avatar, alt: '' });
  const letter = (author.username || author.name || '?').replace(/^@/, '').charAt(0).toUpperCase();
  return h('span', { class: 'avatar', 'aria-hidden': 'true' }, letter);
}

const creatorName = (r) => (r.author?.username ? `@${r.author.username}` : r.author?.name || sourceName(r));

function card(r) {
  const minutes = recipeMinutes(r.recipe);
  const status = r.pending ? 'Reading the post…' : r.error ? "Couldn't load · tap to retry" : creatorName(r);
  return h(
    'a',
    { class: `card${r.pending ? ' pending' : ''}${r.error ? ' failed' : ''}`, href: `#/r/${r.id}` },
    r.thumbnail ? h('img', { src: r.thumbnail, alt: '', decoding: 'async' }) : h('div', { class: 'placeholder' }, '🍲'),
    minutes && !r.pending ? h('span', { class: 'time-badge' }, icon('clock'), shortTime(minutes)) : null,
    r.favorite && h('span', { class: 'fav-badge', 'aria-label': 'Favorite' }, icon('heart')),
    h(
      'div',
      { class: 'card-panel glass' },
      h(
        'div',
        { class: 'card-creator' },
        r.pending ? h('span', { class: 'spinner' }) : r.error ? null : avatarEl(r.author),
        h('span', { class: 'name' }, status),
        r.cookCount > 0 && !r.pending ? h('span', { class: 'made' }, r.cookCount > 1 ? `Made ${r.cookCount}×` : 'Made it') : null,
      ),
      h('h3', { class: 'card-title' }, r.title || 'Untitled'),
    ),
  );
}

function renderEmpty(empty) {
  if (!state.recipes.length) {
    empty.replaceChildren(
      h('h2', {}, 'Save your first recipe'),
      h('p', {}, 'Keep the recipes you find on Instagram in one place, so you actually cook them.'),
      h(
        'ol',
        { class: 'how-to' },
        h('li', {}, 'In Instagram, tap the share arrow on a post or reel, then ', h('b', {}, 'Copy link'), '.'),
        h('li', {}, 'Come back here and tap ', h('b', {}, 'Add recipe'), ', then ', h('b', {}, 'Paste link & save'), '.'),
        h('li', {}, 'You get the thumbnail, the creator, and the recipe from the caption, ready to cook from.'),
      ),
    );
  } else {
    empty.replaceChildren(h('h2', {}, 'Nothing matches'), h('p', {}, 'Try another word or clear the filter.'));
  }
}

const LIST_TITLES = { all: 'Saved', fav: 'Favorites', totry: 'To try', made: 'Made it' };

function renderList() {
  renderFilters();
  const items = visibleRecipes();
  $('#grid').replaceChildren(...items.map(card));
  const empty = $('#empty');
  empty.hidden = items.length > 0;
  if (!items.length) renderEmpty(empty);
  $('#list-head').hidden = items.length === 0;
  $('#list-title').textContent = state.query.trim() ? 'Results' : LIST_TITLES[state.filter] || `#${state.filter.slice(4)}`;
  $('#count').textContent = `${items.length} recipe${items.length === 1 ? '' : 's'}`;
}

/* ------------------------------------------------------------------ */
/* Recipe view                                                         */
/* ------------------------------------------------------------------ */

let wakeLock = null;
let wantWakeLock = false;

async function setWakeLock(on) {
  wantWakeLock = on;
  try {
    if (on && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        updateWakeButton();
      });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wantWakeLock = false;
    toast("Couldn't keep the screen on here.");
  }
  updateWakeButton();
}

function updateWakeButton() {
  const btn = $('#wake-btn');
  if (!btn) return;
  btn.classList.toggle('on', Boolean(wakeLock));
  btn.setAttribute('aria-pressed', String(Boolean(wakeLock)));
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantWakeLock && state.openId && !wakeLock) setWakeLock(true);
});

function openRecipe(id) {
  location.hash = `#/r/${id}`;
}

function goBack() {
  if (state.cameFromList) history.back();
  else location.replace('#/');
}

function sourceCta(r) {
  if (r.mediaType === 'video') return r.source === 'tiktok' ? 'Watch on TikTok' : r.source === 'youtube' ? 'Watch on YouTube' : 'Watch on Instagram';
  return r.source === 'instagram' ? 'Open on Instagram' : 'Open website';
}

function metaPill(iconName, label, value) {
  if (!value) return null;
  return h('span', { class: 'meta-pill' }, iconName && icon(iconName), label && h('span', {}, label), h('b', {}, value));
}

function toggleCheck(r, kind, key, button) {
  r.checks ??= { ing: [], steps: [] };
  const list = r.checks[kind];
  const i = list.indexOf(key);
  if (i === -1) list.push(key);
  else list.splice(i, 1);
  button.classList.toggle('done', i === -1);
  button.setAttribute('aria-pressed', String(i === -1));
  save(r, { rerender: false });
  const reset = $(`#reset-${kind}`);
  if (reset) reset.hidden = list.length === 0;
}

function resetChecks(r, kind) {
  r.checks[kind] = [];
  save(r);
}

function ingredientsSection(r) {
  const groups = r.recipe?.ingredients || [];
  if (!groups.length) return null;
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const done = new Set(r.checks?.ing || []);
  return h(
    'section',
    { class: 'section' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', {}, 'Ingredients ', h('span', { class: 'count' }, `(${total})`)),
      h('button', { class: 'link-btn', id: 'reset-ing', hidden: done.size === 0, onclick: () => resetChecks(r, 'ing') }, 'Uncheck all'),
    ),
    groups.map((g, gi) => [
      g.group && h('p', { class: 'group-name' }, g.group),
      h(
        'ul',
        { class: 'checklist' },
        g.items.map((item, ii) => {
          const key = `${gi}-${ii}`;
          const isDone = done.has(key);
          const btn = h(
            'button',
            { class: `check${isDone ? ' done' : ''}`, 'aria-pressed': String(isDone) },
            h('span', { class: 'box' }, icon('check')),
            h('span', { class: 'text' }, item),
          );
          btn.addEventListener('click', () => toggleCheck(r, 'ing', key, btn));
          return h('li', {}, btn);
        }),
      ),
    ]),
  );
}

function stepsSection(r) {
  const steps = r.recipe?.steps || [];
  if (!steps.length) return null;
  const done = new Set(r.checks?.steps || []);
  return h(
    'section',
    { class: 'section' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', {}, 'Steps'),
      h('button', { class: 'link-btn', id: 'reset-steps', hidden: done.size === 0, onclick: () => resetChecks(r, 'steps') }, 'Reset'),
    ),
    h(
      'ol',
      { class: 'steps' },
      steps.map((step, i) => {
        const isDone = done.has(i);
        const btn = h(
          'button',
          { class: `step${isDone ? ' done' : ''}`, 'aria-pressed': String(isDone) },
          h('span', { class: 'num' }, String(i + 1)),
          h('span', {}, step),
        );
        btn.addEventListener('click', () => toggleCheck(r, 'steps', i, btn));
        return h('li', {}, btn);
      }),
    ),
  );
}

function statusCallout(r) {
  const openBtn = h('a', { class: 'btn', href: r.url, target: '_blank', rel: 'noopener' }, icon('external'), sourceCta(r));
  if (r.pending) {
    return h('div', { class: 'callout' }, h('h3', {}, 'Reading the post…'), h('p', {}, 'Grabbing the thumbnail, creator and recipe. This takes a few seconds.'), h('span', { class: 'spinner' }));
  }
  if (r.error) {
    return h(
      'div',
      { class: 'callout' },
      h('h3', {}, "Couldn't read this link"),
      h('p', {}, r.error),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => loadIntoRecord(r) }, icon('refresh'), 'Try again'),
        openBtn,
        h('button', { class: 'btn', onclick: () => openEditor(r) }, icon('edit'), 'Write it in'),
      ),
    );
  }
  if (!r.hasRecipe && !(r.recipe?.ingredients?.length || r.recipe?.steps?.length)) {
    return h(
      'div',
      { class: 'callout' },
      h('h3', {}, 'No written recipe in this post'),
      h('p', {}, 'The creator probably says it in the video, or sends it by DM ("comment RECIPE"). Watch it, then jot the recipe down here so you have it.'),
      h('div', { class: 'row' }, openBtn, h('button', { class: 'btn', onclick: () => openEditor(r) }, icon('edit'), 'Write it in')),
    );
  }
  return null;
}

function renderDetail(r, { keepScroll = false } = {}) {
  const view = $('#detail-view');
  const scroll = keepScroll ? view.scrollTop : 0;
  const recipe = r.recipe || {};
  const author = r.author || {};
  const tab = r.caption ? state.detailTab : 'recipe';
  const ready = !r.pending && !r.error;

  const favBtn = h(
    'button',
    { class: `icon-btn${r.favorite ? ' on' : ''}`, 'aria-label': r.favorite ? 'Remove from favorites' : 'Add to favorites', 'aria-pressed': String(Boolean(r.favorite)) },
    icon('heart', { filled: r.favorite }),
  );
  favBtn.addEventListener('click', () => {
    r.favorite = !r.favorite;
    save(r);
  });

  const bar = h(
    'div',
    { class: 'detail-bar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: goBack }, icon('back')),
    h('div', { class: 'actions' }, favBtn, h('button', { class: 'icon-btn', 'aria-label': 'More', onclick: () => openMenu(r) }, icon('more'))),
  );

  const hero = h(
    'a',
    { class: 'hero', href: r.url, target: '_blank', rel: 'noopener', 'aria-label': sourceCta(r) },
    r.thumbnail ? h('img', { src: r.thumbnail, alt: '' }) : h('div', { class: 'placeholder' }, '🍲'),
    r.mediaType === 'video' && !r.pending && h('span', { class: 'play glass' }, icon('play')),
  );

  const creator =
    author.username || author.name
      ? h(
          author.url ? 'a' : 'div',
          { class: 'creator', href: author.url || null, target: author.url ? '_blank' : null, rel: 'noopener' },
          avatarEl(author),
          h('span', { class: 'name' }, creatorName(r)),
          h('span', { class: 'via' }, `on ${sourceName(r)}`),
          author.url && icon('arrow'),
        )
      : null;

  const minutes = recipeMinutes(recipe);
  const meta = h(
    'div',
    { class: 'meta' },
    metaPill('clock', null, minutes && shortTime(minutes)),
    metaPill(null, 'Ready', minutes && readyAt(minutes)),
    metaPill('bowl', null, recipe.servings),
    recipe.totalTime && metaPill(null, 'Prep', parseMinutes(recipe.prepTime) && shortTime(parseMinutes(recipe.prepTime))),
    recipe.totalTime && metaPill(null, 'Cook', parseMinutes(recipe.cookTime) && shortTime(parseMinutes(recipe.cookTime))),
  );

  const tabPill = (id, iconName, label) =>
    h('button', {
      class: `pill${tab === id ? ' on' : ''}`,
      'aria-pressed': String(tab === id),
      onclick: () => {
        state.detailTab = id;
        renderDetail(r, { keepScroll: true });
      },
    }, icon(iconName), label);

  const madeBtn = h('button', { class: 'pill' }, icon('check'), r.cookCount ? `Made ${r.cookCount}×` : 'I made this');
  madeBtn.addEventListener('click', () => {
    const previous = { cookCount: r.cookCount || 0, lastCookedAt: r.lastCookedAt };
    r.cookCount = previous.cookCount + 1;
    r.lastCookedAt = Date.now();
    save(r);
    toast(r.cookCount === 1 ? 'Nice! Marked as made 🎉' : `Made ${r.cookCount} times 🎉`, {
      action: 'Undo',
      onAction: () => {
        Object.assign(r, previous);
        save(r);
      },
    });
  });

  const hasSteps = (recipe.ingredients?.length || 0) + (recipe.steps?.length || 0) > 0;
  const wakeBtn =
    'wakeLock' in navigator && hasSteps
      ? h('button', {
          class: 'pill',
          id: 'wake-btn',
          onclick: async () => {
            await setWakeLock(!wakeLock);
            if (wakeLock) toast('Screen stays on while this recipe is open');
          },
        }, icon('sun'), 'Keep screen on')
      : null;

  const pills = h(
    'div',
    { class: 'pill-row' },
    tabPill('recipe', 'flame', 'Recipe'),
    r.caption && tabPill('caption', 'caption', 'Caption'),
    h('span', { class: 'divider' }),
    h('a', { class: 'pill', href: r.url, target: '_blank', rel: 'noopener' }, icon(r.mediaType === 'video' ? 'play' : 'external'), r.mediaType === 'video' ? 'Watch' : 'Open'),
    ready && madeBtn,
    wakeBtn,
  );

  let notesTimer;
  const myNotes = h('textarea', {
    class: 'my-notes',
    placeholder: 'Tweaks, what worked, what to change next time…',
    value: r.myNotes || '',
    oninput: (e) => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => {
        r.myNotes = e.target.value;
        save(r, { rerender: false });
      }, 400);
    },
  });

  const tags = recipe.tags?.length
    ? h(
        'div',
        { class: 'tags' },
        recipe.tags.map((t) =>
          h('button', {
            class: 'tag',
            onclick: () => {
              state.filter = `tag:${t}`;
              state.query = '';
              $('#search').value = '';
              renderList();
              goBack();
            },
          }, `#${t}`),
        ),
      )
    : null;

  const sourceLine = h('p', { class: 'source-line' }, `Saved ${formatDate(r.createdAt)} from ${sourceName(r)}${r.edited ? ' · edited by you' : ''}`);

  const content =
    tab === 'caption'
      ? [h('p', { class: 'caption-text' }, r.caption), sourceLine]
      : [
          statusCallout(r),
          ingredientsSection(r),
          stepsSection(r),
          recipe.notes ? h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', {}, 'Creator’s notes')), h('p', { class: 'creator-notes' }, recipe.notes)) : null,
          h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', {}, 'My notes')), myNotes),
          tags,
          sourceLine,
        ];

  const body = h(
    'div',
    { class: 'detail-body' },
    creator,
    h('h1', { class: 'detail-title' }, r.title || 'Untitled'),
    meta.childElementCount ? meta : null,
    recipe.description ? h('p', { class: 'description' }, recipe.description) : null,
    pills,
    content,
  );

  view.replaceChildren(bar, hero, body);
  view.onscroll = () => bar.classList.toggle('solid', view.scrollTop > hero.offsetHeight - 90);
  view.hidden = false;
  document.body.classList.add('no-scroll');
  view.scrollTop = scroll;
  view.onscroll();
  updateWakeButton();
}

function closeDetail() {
  state.openId = null;
  $('#detail-view').hidden = true;
  $('#detail-view').replaceChildren();
  document.body.classList.remove('no-scroll');
  if (wakeLock || wantWakeLock) setWakeLock(false);
}

/* ------------------------------------------------------------------ */
/* Sheets: add, menu, edit, settings                                   */
/* ------------------------------------------------------------------ */

const sheet = $('#sheet');

function openSheet(...children) {
  // The grabber takes the initial focus so iOS doesn't pop the keyboard up for the first text field.
  sheet.replaceChildren(h('div', { class: 'sheet-inner' }, h('div', { class: 'grabber', tabindex: '-1', autofocus: true }), ...children));
  if (!sheet.open) sheet.showModal();
}

function closeSheet() {
  if (sheet.open) sheet.close();
}

sheet.addEventListener('click', (e) => {
  if (e.target === sheet) closeSheet(); // tap on the dimmed backdrop
});

function openAddSheet() {
  const input = h('input', {
    type: 'url',
    inputmode: 'url',
    placeholder: 'https://www.instagram.com/reel/…',
    autocomplete: 'off',
    autocapitalize: 'off',
    enterkeyhint: 'done',
  });
  // Toasts would sit behind the open sheet, so problems are shown inside it.
  const problem = h('p', { class: 'hint', role: 'alert', style: 'color:var(--warn);margin:12px 0 0', hidden: true });
  const showProblem = (text) => {
    problem.textContent = text;
    problem.hidden = false;
  };
  const submit = () => {
    const value = input.value.trim();
    if (!findUrl(value)) {
      showProblem("That doesn't look like a link. In Instagram: Share → Copy link.");
      input.focus();
      return;
    }
    closeSheet();
    addLink(value);
  };
  const pasteBtn = h('button', { class: 'btn primary block' }, icon('paste'), 'Paste link & save');
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (findUrl(text)) {
        closeSheet();
        addLink(text);
        return;
      }
      showProblem("There's no link on your clipboard yet. In Instagram: Share → Copy link.");
    } catch {
      showProblem('Long-press the box below and choose Paste.');
    }
    input.focus();
  });
  openSheet(
    h('h2', {}, 'Save a recipe'),
    h('p', { class: 'hint' }, 'In Instagram tap the share arrow → Copy link, then come back here. TikTok, YouTube and recipe websites work too.'),
    navigator.clipboard?.readText ? pasteBtn : null,
    problem,
    h(
      'form',
      {
        style: 'margin-top:16px',
        onsubmit: (e) => {
          e.preventDefault();
          submit();
        },
      },
      h('label', { class: 'field' }, h('span', {}, navigator.clipboard?.readText ? 'Or paste it here' : 'Paste the link'), input),
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: closeSheet }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save')),
    ),
  );
}

function openMenu(r) {
  const item = (iconName, label, onclick, cls = '') => h('button', { class: `btn block ${cls}`, onclick }, icon(iconName), label);
  openSheet(
    h('div', { class: 'menu' },
      item('edit', 'Edit recipe', () => openEditor(r)),
      item('refresh', 'Reload from the link', () => {
        if (r.edited && !confirm('Reloading replaces the changes you made to this recipe. Continue?')) return;
        closeSheet();
        loadIntoRecord(r);
      }),
      navigator.share
        ? item('share', 'Share link', () => {
            closeSheet();
            navigator.share({ title: r.title, url: r.url }).catch(() => {});
          })
        : item('link', 'Copy link', async () => {
            closeSheet();
            try {
              await navigator.clipboard.writeText(r.url);
              toast('Link copied');
            } catch {
              toast(r.url);
            }
          }),
      item('trash', 'Delete recipe', async () => {
        if (!confirm(`Delete “${shorten(r.title, 60)}”?`)) return;
        closeSheet();
        await removeRecipe(r.id);
        goBack();
        toast('Recipe deleted', {
          action: 'Undo',
          onAction: async () => {
            await save(r);
            openRecipe(r.id);
          },
        });
      }, 'danger'),
      item('back', 'Cancel', closeSheet),
    ),
  );
}

const ingredientsToText = (groups = []) =>
  groups.map((g) => [g.group ? `${g.group}:` : null, ...g.items].filter(Boolean).join('\n')).join('\n\n');

function textToIngredients(text) {
  const groups = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[\s•·\-*–]+/, '').trim();
    if (!line) continue;
    if (line.endsWith(':') && line.length <= 50) {
      current = { group: line.slice(0, -1).trim(), items: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { group: '', items: [] };
      groups.push(current);
    }
    current.items.push(line);
  }
  return groups.filter((g) => g.items.length);
}

const textToSteps = (text) =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:step\s*)?\d{1,2}\s*[.):-]\s*/i, '').trim())
    .filter(Boolean);

function openEditor(r) {
  const recipe = r.recipe || {};
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint && h('small', {}, hint));
  const title = h('input', { value: r.title || '', autocapitalize: 'sentences' });
  const ingredients = h('textarea', { value: ingredientsToText(recipe.ingredients), rows: 8 });
  const steps = h('textarea', { value: (recipe.steps || []).join('\n'), rows: 8 });
  const prep = h('input', { value: recipe.prepTime || '', placeholder: '10 min' });
  const cook = h('input', { value: recipe.cookTime || '', placeholder: '25 min' });
  const total = h('input', { value: recipe.totalTime || '', placeholder: '35 min' });
  const serves = h('input', { value: recipe.servings || '', placeholder: '4', inputmode: 'text' });
  const tags = h('input', { value: (recipe.tags || []).join(', '), placeholder: 'pasta, weeknight', autocapitalize: 'off' });
  const notes = h('textarea', { value: recipe.notes || '', rows: 3 });

  openSheet(
    h('h2', {}, 'Edit recipe'),
    h('p', { class: 'hint' }, 'One ingredient per line. A line ending in ":" starts a group, like "Sauce:". One step per line.'),
    h(
      'form',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          const newIngredients = textToIngredients(ingredients.value);
          const newSteps = textToSteps(steps.value);
          r.title = title.value.trim() || r.title;
          r.recipe = {
            ...recipe,
            ingredients: newIngredients,
            steps: newSteps,
            prepTime: prep.value.trim(),
            cookTime: cook.value.trim(),
            totalTime: total.value.trim(),
            servings: serves.value.trim(),
            notes: notes.value.trim(),
            tags: tags.value.split(',').map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean),
          };
          r.hasRecipe = newIngredients.length > 0 || newSteps.length > 0;
          // Ticks point at list positions, so only keep them if that list didn't change.
          const same = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
          r.checks = {
            ing: same(newIngredients, recipe.ingredients) ? r.checks?.ing || [] : [],
            steps: same(newSteps, recipe.steps) ? r.checks?.steps || [] : [],
          };
          r.edited = true;
          r.error = null;
          closeSheet();
          await save(r);
          toast('Recipe updated');
        },
      },
      field('Name', title),
      field('Ingredients', ingredients),
      field('Steps', steps),
      h('div', { class: 'field-grid' }, field('Prep time', prep), field('Cook time', cook), field('Total time', total), field('Serves', serves)),
      field('Tags', tags, 'Separate with commas'),
      field('Notes & tips', notes),
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: closeSheet }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save')),
    ),
  );
}

async function exportBackup() {
  const recipes = await db.all();
  const json = JSON.stringify({ app: 'recipe-box', version: 1, exportedAt: new Date().toISOString(), recipes });
  const name = `recipe-box-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Recipe Box backup' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const a = h('a', { href: URL.createObjectURL(file), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    const incoming = (Array.isArray(data) ? data : data.recipes || []).filter((r) => r && typeof r.id === 'string' && typeof r.url === 'string');
    if (!incoming.length) throw new Error('empty');
    const current = new Map(state.recipes.map((r) => [r.id, r]));
    const toWrite = incoming.filter((r) => !current.has(r.id) || (r.updatedAt || 0) > (current.get(r.id).updatedAt || 0));
    await db.putMany(toWrite.map((r) => ({ ...r, pending: false })));
    await loadAll();
    renderList();
    toast(toWrite.length ? `Restored ${toWrite.length} recipe${toWrite.length === 1 ? '' : 's'}` : 'Everything in that backup is already here');
  } catch {
    toast("That file isn't a Recipe Box backup.");
  }
}

async function openSettings() {
  const statusLine = (label, value) => h('div', { class: 'status-line' }, h('span', {}, label), h('span', { class: 'value' }, value));
  const serverStatus = h('div', {}, statusLine('Server', 'Checking…'));
  const password = h('input', { type: 'password', value: state.password, placeholder: 'Only if you set APP_PASSWORD', autocomplete: 'current-password' });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: (e) => {
      const [file] = e.target.files;
      e.target.value = ''; // so picking the same file again still triggers a restore
      if (file) importBackup(file);
    },
  });

  let used = '';
  try {
    const { usage } = await navigator.storage.estimate();
    used = `${(usage / 1024 / 1024).toFixed(1)} MB`;
  } catch {
    // Not available
  }

  openSheet(
    h('h2', {}, 'Settings'),
    h('p', { class: 'hint' }, `${state.recipes.length} recipes saved on this phone${used ? ` · ${used} used` : ''}.`),
    h('div', { class: 'settings-group' }, h('h3', {}, 'Server'), serverStatus),
    h(
      'div',
      { class: 'settings-group' },
      h('h3', {}, 'App password'),
      h(
        'form',
        {
          onsubmit: (e) => {
            e.preventDefault();
            state.password = password.value;
            storage.set('appPassword', password.value);
            toast('Password saved');
            closeSheet();
          },
        },
        h('label', { class: 'field' }, password, h('small', {}, 'Stops strangers from using your link reader. Set it on the server as APP_PASSWORD.')),
        h('button', { class: 'btn block', type: 'submit' }, 'Save password'),
      ),
    ),
    h(
      'div',
      { class: 'settings-group' },
      h('h3', {}, 'Backup'),
      h('p', { class: 'hint' }, 'Your recipes live only on this phone. Save a backup to Files or iCloud now and then.'),
      h('div', { class: 'menu' }, h('button', { class: 'btn block', onclick: exportBackup }, icon('share'), 'Save a backup'), h('button', { class: 'btn block', onclick: () => fileInput.click() }, icon('refresh'), 'Restore from a backup'), fileInput),
    ),
    h('button', { class: 'btn block', onclick: closeSheet }, 'Done'),
  );

  try {
    const res = await fetch('/api/status', { headers: state.password ? { 'x-app-password': state.password } : {} });
    const s = await res.json();
    serverStatus.replaceChildren(
      statusLine('Server', 'Connected'),
      statusLine('AI recipe reader', s.ai ? 'On' : 'Off · built-in reader'),
      statusLine('Password', s.passwordRequired ? (s.passwordAccepted ? 'Set and correct' : 'Needed — enter below') : 'Not required'),
    );
  } catch {
    serverStatus.replaceChildren(statusLine('Server', 'Offline — saved recipes still work'));
  }
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

let toastTimer;
function toast(message, { action, onAction, duration = 4000 } = {}) {
  const el = $('#toast');
  el.hidden = true;
  el.replaceChildren(h('span', {}, message));
  if (action) {
    el.append(
      h('button', {
        onclick: () => {
          el.hidden = true;
          onAction();
        },
      }, action),
    );
  }
  void el.offsetWidth; // restart the slide-in animation
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, duration);
}

/* ------------------------------------------------------------------ */
/* Routing & start-up                                                  */
/* ------------------------------------------------------------------ */

function route() {
  const id = location.hash.match(/^#\/r\/([\w-]+)/)?.[1];
  const record = id && byId(id);
  if (record) {
    state.cameFromList = state.cameFromList || state.openId === null;
    if (state.openId !== id) state.detailTab = 'recipe';
    state.openId = id;
    closeSheet();
    renderDetail(record);
    return;
  }
  if (id) location.replace('#/');
  if (state.openId) closeDetail();
  state.cameFromList = false;
}

async function loadAll() {
  state.recipes = (await db.all()).sort((a, b) => b.createdAt - a.createdAt);
}

async function start() {
  await loadAll();
  renderList();

  $('#add-btn').addEventListener('click', openAddSheet);
  $('#settings-btn').addEventListener('click', openSettings);
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderList();
  });
  window.addEventListener('hashchange', route);
  state.cameFromList = false;
  route();
  // Deep-linked straight to a recipe: "back" should land on the list, not leave the app.
  state.cameFromList = false;

  // Links shared into the app (Android share sheet, iOS Shortcut: /?url=...)
  const params = new URLSearchParams(location.search);
  const shared = ['url', 'text', 'title'].map((k) => params.get(k)).filter(Boolean).join(' ');
  if (shared) {
    history.replaceState(null, '', `/${location.hash}`);
    addLink(shared);
  }

  // Finish anything that was still loading when the app was closed.
  for (const r of state.recipes) if (r.pending) loadIntoRecord(r);

  requestPersistentStorage();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

start();
