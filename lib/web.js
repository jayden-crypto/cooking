// Readers for non-Instagram links: TikTok and YouTube (via oEmbed) and any
// other web page (Open Graph tags + schema.org Recipe data, which most recipe
// blogs publish and which already contains the full ingredient list and steps).

import { BROWSER_UA, fetchJson, fetchText } from './http.js';
import { cleanString, decodeEntities, formatIsoDuration, tidyMultiline } from './text.js';

export function isTikTokUrl(url) {
  return /(^|\.)tiktok\.com$/i.test(new URL(url).hostname);
}

export function isYouTubeUrl(url) {
  return /(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(url).hostname);
}

export async function fetchTikTok(link) {
  const data = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(link)}`, {
    headers: { 'user-agent': BROWSER_UA },
  });
  const username = (data.author_url || '').match(/@([^/?]+)/)?.[1] || data.author_unique_id || '';
  return {
    caption: tidyMultiline(data.title || ''),
    username,
    authorName: data.author_name || '',
    profileUrl: data.author_url || '',
    imageUrl: data.thumbnail_url || '',
    mediaType: 'video',
  };
}

export async function fetchYouTube(link) {
  const data = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link)}`, {
    headers: { 'user-agent': BROWSER_UA },
  });
  // The description (where creators put recipes) isn't in oEmbed; it is embedded in the watch page.
  let description = '';
  try {
    const { text } = await fetchText(link, { headers: { 'user-agent': BROWSER_UA }, maxBytes: 3_000_000 });
    const m = text.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (m) description = JSON.parse(`"${m[1]}"`);
  } catch {
    // Title + thumbnail are still useful without the description.
  }
  return {
    title: data.title || '',
    caption: tidyMultiline([data.title, description].filter(Boolean).join('\n\n')),
    username: (data.author_url || '').match(/@([^/?]+)/)?.[1] || '',
    authorName: data.author_name || '',
    profileUrl: data.author_url || '',
    imageUrl: data.thumbnail_url || '',
    mediaType: 'video',
  };
}

function metaContent(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  if (!tag) return '';
  return decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] || '');
}

function* walkJsonLd(node) {
  if (Array.isArray(node)) {
    for (const n of node) yield* walkJsonLd(n);
  } else if (node && typeof node === 'object') {
    yield node;
    if (node['@graph']) yield* walkJsonLd(node['@graph']);
    if (node.mainEntity) yield* walkJsonLd(node.mainEntity);
  }
}

function findRecipeJsonLd(html) {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const node of walkJsonLd(data)) {
      const type = node['@type'];
      if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) return node;
    }
  }
  return null;
}

const text = (v) =>
  cleanString(decodeEntities(typeof v === 'string' ? v : ''))
    // WordPress recipe plugins produce "((Note 1))" and "(, finely chopped)"
    .replace(/\(\(/g, '(')
    .replace(/\)\)/g, ')')
    .replace(/\(\s*,\s*/g, '(')
    .replace(/\s+\)/g, ')');

function firstImage(image) {
  if (!image) return '';
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return firstImage(image[0]);
  return image.url || image.contentUrl || '';
}

function authorName(author) {
  if (!author) return '';
  if (typeof author === 'string') return author;
  if (Array.isArray(author)) return authorName(author[0]);
  return author.name || '';
}

function flattenInstructions(instructions) {
  if (!instructions) return [];
  if (typeof instructions === 'string') {
    return decodeEntities(instructions.replace(/<[^>]+>/g, '\n'))
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(instructions)) return instructions.flatMap(flattenInstructions);
  if (instructions.itemListElement) return flattenInstructions(instructions.itemListElement);
  return [text(instructions.text || instructions.name || '')].filter(Boolean);
}

function toList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.flatMap(toList);
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/** Converts a schema.org Recipe object into our recipe shape. Exported for tests. */
export function recipeFromJsonLd(node) {
  const yieldValue = Array.isArray(node.recipeYield) ? node.recipeYield[0] : node.recipeYield;
  const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : toList(node.recipeIngredient))
    .map(text)
    .filter(Boolean);
  // Cuisine and category make good tags; "keywords" are usually SEO phrases, so they're skipped.
  const tags = [...toList(node.recipeCuisine), ...toList(node.recipeCategory)]
    .map((t) => text(t).toLowerCase())
    .filter((t, i, all) => t && t.length <= 30 && all.indexOf(t) === i)
    .slice(0, 8);
  return {
    title: text(node.name),
    description: text(node.description).slice(0, 400),
    ingredients: ingredients.length ? [{ group: '', items: ingredients }] : [],
    steps: flattenInstructions(node.recipeInstructions).map(text).filter(Boolean),
    prepTime: formatIsoDuration(node.prepTime),
    cookTime: formatIsoDuration(node.cookTime),
    totalTime: formatIsoDuration(node.totalTime),
    servings: yieldValue != null ? text(String(yieldValue)) : '',
    notes: '',
    tags,
    hasRecipe: ingredients.length > 0,
    imageUrl: firstImage(node.image),
    author: authorName(node.author),
  };
}

/** Reads a regular web page. Exported pieces are used for tests. */
export function parseWebPage(html, pageUrl) {
  const recipeNode = findRecipeJsonLd(html);
  const schemaRecipe = recipeNode ? recipeFromJsonLd(recipeNode) : null;
  const ogImage = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
  const title =
    schemaRecipe?.title ||
    metaContent(html, 'og:title') ||
    decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim();
  const siteName = metaContent(html, 'og:site_name') || new URL(pageUrl).hostname.replace(/^www\./, '');
  return {
    title,
    caption: tidyMultiline(metaContent(html, 'og:description') || metaContent(html, 'description')),
    username: '',
    authorName: schemaRecipe?.author || metaContent(html, 'author') || siteName,
    profileUrl: new URL('/', pageUrl).toString(),
    imageUrl: schemaRecipe?.imageUrl ? new URL(schemaRecipe.imageUrl, pageUrl).toString() : ogImage ? new URL(ogImage, pageUrl).toString() : '',
    mediaType: metaContent(html, 'og:type').startsWith('video') ? 'video' : 'image',
    schemaRecipe,
  };
}

export async function fetchWebPage(link) {
  const { text: html, finalUrl } = await fetchText(link, {
    headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml' },
  });
  return { ...parseWebPage(html, finalUrl), finalUrl };
}
