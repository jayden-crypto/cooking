// Reads a public Instagram post/reel through its embed page, which Instagram
// serves without a login: creator, thumbnail and the full caption.

import { BROWSER_UA, CRAWLER_UA, FetchError, fetchText, safeFetch } from './http.js';
import { decodeEntities, htmlToText } from './text.js';

const IG_HOST = /(^|\.)(instagram\.com|instagr\.am)$/i;

/** Returns { kind, code } for post/reel links, { share: true } for /share/ links, or null. */
export function parseInstagramUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!IG_HOST.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'share') return { share: true };
  // Handles /p/CODE, /reel/CODE, /reels/CODE, /tv/CODE and /username/p/CODE
  const i = parts.findIndex((p) => ['p', 'reel', 'reels', 'tv'].includes(p));
  if (i === -1 || !parts[i + 1] || !/^[A-Za-z0-9_-]{5,}$/.test(parts[i + 1])) return { profileOrOther: true };
  return { kind: parts[i] === 'reels' ? 'reel' : parts[i], code: parts[i + 1] };
}

export function isInstagramUrl(input) {
  return parseInstagramUrl(input) !== null;
}

/** instagram.com/share/... links redirect to the real post; follow the hops until one names a post. */
async function resolveShareLink(link) {
  let current = link;
  for (let hop = 0; hop < 5; hop++) {
    const res = await safeFetch(current, { headers: { 'user-agent': BROWSER_UA }, maxRedirects: 0 });
    await res.body?.cancel();
    const location = res.headers.get('location');
    if (!location) return null;
    const next = new URL(location, current);
    // A login redirect carries the post in ?next=
    const candidates = [next.toString(), next.searchParams.get('next') || ''];
    for (const c of candidates) {
      const parsed = c && parseInstagramUrl(new URL(c, 'https://www.instagram.com').toString());
      if (parsed?.code) return parsed;
    }
    current = next.toString();
  }
  return null;
}

function extractContextJson(html) {
  const m = html.match(/"contextJSON":"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    return JSON.parse(JSON.parse(`"${m[1]}"`));
  } catch {
    return null;
  }
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

/** Parses the HTML of /p/CODE/embed/captioned/. Exported for tests. */
export function parseInstagramEmbed(html, code) {
  const post = {
    shortcode: code,
    username: '',
    avatarUrl: '',
    imageUrl: '',
    caption: '',
    mediaType: 'image',
  };

  const media = extractContextJson(html)?.gql_data?.shortcode_media;
  if (media) {
    post.username = media.owner?.username || '';
    post.avatarUrl = media.owner?.profile_pic_url || '';
    post.imageUrl = media.display_url || media.thumbnail_src || '';
    post.caption = media.edge_media_to_caption?.edges?.[0]?.node?.text || '';
    post.mediaType = media.is_video ? 'video' : media.__typename === 'GraphSidecar' ? 'carousel' : 'image';
  }

  // The server-rendered markup carries the same data; use it to fill any gaps.
  if (!post.username) {
    const m = html.match(/class="UsernameText"[^>]*>([^<]+)</) || html.match(/class="CaptionUsername"[^>]*>([^<]+)</);
    if (m) post.username = decodeEntities(m[1]).trim();
  }
  if (!post.imageUrl) {
    const img = html.match(/<img[^>]*class="EmbeddedMediaImage"[^>]*>/);
    if (img) post.imageUrl = attr(img[0], 'src');
  }
  if (!post.avatarUrl) {
    const avatar = html.match(/class="Avatar"[^>]*>\s*<img[^>]*>/);
    if (avatar) post.avatarUrl = attr(avatar[0].slice(avatar[0].lastIndexOf('<img')), 'src');
  }
  if (!post.caption) {
    const m = html.match(/<div class="Caption">([\s\S]*?)<div class="CaptionComments"/);
    if (m) {
      const withoutUsername = m[1].replace(/<a class="CaptionUsername"[\s\S]*?<\/a>/, '');
      post.caption = htmlToText(withoutUsername);
    }
  }
  if (post.mediaType === 'image') {
    const type = html.match(/data-media-type="(Graph\w+)"/)?.[1];
    if (type === 'GraphVideo') post.mediaType = 'video';
    if (type === 'GraphSidecar') post.mediaType = 'carousel';
  }

  return post;
}

export async function fetchInstagramPost(link) {
  let parsed = parseInstagramUrl(link);
  if (parsed?.share) parsed = await resolveShareLink(link);
  if (!parsed?.code) {
    throw new FetchError("That doesn't look like a link to an Instagram post or reel", 400);
  }

  const embedUrl = `https://www.instagram.com/p/${parsed.code}/embed/captioned/`;
  const { text: html } = await fetchText(embedUrl, { headers: { 'user-agent': CRAWLER_UA } });
  const post = parseInstagramEmbed(html, parsed.code);

  if (!post.username && !post.imageUrl) {
    throw new FetchError("Couldn't read this post. It may be private, deleted, or Instagram blocked the request.", 422);
  }

  const kind = post.mediaType === 'video' ? 'reel' : 'p';
  return {
    ...post,
    canonicalUrl: `https://www.instagram.com/${kind}/${parsed.code}/`,
    profileUrl: post.username ? `https://www.instagram.com/${post.username}/` : '',
  };
}
