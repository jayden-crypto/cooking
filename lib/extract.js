// Turns a pasted link into everything the app stores: thumbnail, creator,
// caption and a structured recipe.

import { aiEnabled, structureRecipeWithClaude } from './ai.js';
import { parseCaption } from './caption-parser.js';
import { FetchError, fetchImageAsDataUrl } from './http.js';
import { fetchInstagramPost, isInstagramUrl } from './instagram.js';
import { fetchTikTok, fetchWebPage, fetchYouTube, isTikTokUrl, isYouTubeUrl } from './web.js';

const TRACKING_PARAMS = /^(utm_\w+|igsh|igshid|si|fbclid|gclid|mc_\w+|ref|ref_src|_r|_t|is_from_webapp|sender_device|feature)$/i;

/** Finds the first link in whatever was pasted ("Check this out! https://...") */
export function findUrl(input) {
  if (typeof input !== 'string') return null;
  const full = input.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  const bare = input.match(/\b(?:www\.)?(?:instagram\.com|instagr\.am|tiktok\.com|vm\.tiktok\.com|youtube\.com|youtu\.be)\/[^\s<>"']+/i)?.[0];
  const candidate = full || (bare && `https://${bare}`);
  if (!candidate) return null;
  try {
    return new URL(candidate.replace(/[),.!?]+$/, '')).toString();
  } catch {
    return null;
  }
}

export function cleanUrl(link) {
  const url = new URL(link);
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  url.hash = '';
  return url.toString();
}

const EMPTY_RECIPE = {
  title: '', description: '', ingredients: [], steps: [], prepTime: '', cookTime: '', totalTime: '',
  servings: '', notes: '', tags: [], hasRecipe: false,
};

async function readRecipe(post, source, warnings) {
  if (post.schemaRecipe?.hasRecipe) {
    const { imageUrl, author, ...recipe } = post.schemaRecipe;
    return { recipe, recipeSource: 'website' };
  }
  if (!post.caption) return { recipe: { ...EMPTY_RECIPE }, recipeSource: 'none' };

  if (aiEnabled()) {
    try {
      const recipe = await structureRecipeWithClaude({ caption: post.caption, pageTitle: post.title, platform: source });
      if (recipe) return { recipe, recipeSource: 'ai' };
    } catch (err) {
      console.error('Claude recipe step failed:', err);
      warnings.push('The AI recipe reader failed, so the built-in reader was used.');
    }
  }
  return { recipe: parseCaption(post.caption), recipeSource: 'parser' };
}

export async function extractFromLink(input) {
  const link = findUrl(input);
  if (!link) throw new FetchError('Paste a link to an Instagram post or reel (or any recipe page).', 400);

  let source;
  let post;
  if (isInstagramUrl(link)) {
    source = 'instagram';
    post = await fetchInstagramPost(link);
  } else if (isTikTokUrl(link)) {
    source = 'tiktok';
    post = { ...(await fetchTikTok(link)), canonicalUrl: cleanUrl(link) };
  } else if (isYouTubeUrl(link)) {
    source = 'youtube';
    post = { ...(await fetchYouTube(link)), canonicalUrl: cleanUrl(link) };
  } else {
    source = 'web';
    const page = await fetchWebPage(link);
    post = { ...page, canonicalUrl: cleanUrl(page.finalUrl) };
  }

  const warnings = [];
  const [{ recipe, recipeSource }, thumbnail, avatar] = await Promise.all([
    readRecipe(post, source, warnings),
    fetchImageAsDataUrl(post.imageUrl),
    fetchImageAsDataUrl(post.avatarUrl),
  ]);

  const host = new URL(post.canonicalUrl).hostname.replace(/^www\./, '');
  const title = recipe.title || post.title || (post.username ? `Recipe from @${post.username}` : `Recipe from ${host}`);
  const { title: _ignored, hasRecipe, ...details } = recipe;

  return {
    url: post.canonicalUrl,
    source,
    mediaType: post.mediaType || 'image',
    title,
    author: {
      username: post.username || '',
      name: post.authorName || '',
      url: post.profileUrl || '',
      avatar,
    },
    caption: post.caption || '',
    thumbnail,
    recipe: details,
    hasRecipe: Boolean(hasRecipe),
    recipeSource,
    warnings,
  };
}
