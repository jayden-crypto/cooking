// Pulls a structured recipe out of a free-form social media caption without AI.
// Captions are messy, so this is a best-effort reader: it looks for an
// ingredients section (lines with quantities/units or under headers like
// "SAUCE:"), numbered or "Method:" steps, notes, times and servings.

import { formatMinutes } from './text.js';

const GENERIC_TAGS = new Set([
  'recipe', 'recipes', 'food', 'foodie', 'foodies', 'cooking', 'cook', 'easyrecipe', 'easyrecipes', 'instafood',
  'reels', 'reel', 'reelsinstagram', 'instagood', 'fyp', 'foryou', 'foryoupage', 'viral', 'explore', 'explorepage',
  'homemade', 'yum', 'yummy', 'delicious', 'foodblogger', 'foodstagram', 'foodporn', 'foodlover', 'tasty', 'trending',
  'homecooking', 'foodreels', 'recipeoftheday', 'recipeideas', 'quickrecipes', 'easymeals', 'cookingathome',
]);

const UNIT =
  '(?:g|gr|grams?|kg|kilos?|mg|ml|mls|millilit(?:er|re)s?|l|lit(?:er|re)s?|dl|cl|cups?|c\\.|tbsps?|tbs|tbl|tablespoons?|tsps?|teaspoons?|oz|ounces?|fl\\.? ?oz|lbs?|pounds?|cloves?|pinch(?:es)?|dash(?:es)?|cans?|tins?|jars?|sticks?|slices?|bunch(?:es)?|handfuls?|sprigs?|stalks?|heads?|knobs?|packs?|packets?|sheets?|pieces?|pcs|quarts?|qt|pints?|pt)';
const QTY = '(?:\\d+(?:[.,]\\d+)?(?:\\s*(?:-|–|to)\\s*\\d+(?:[.,]\\d+)?)?(?:\\s+\\d/\\d)?|\\d+/\\d+|[½⅓⅔¼¾⅛⅜⅝⅞])';

const QTY_START = new RegExp(`^(?:${QTY}\\s*[½⅓⅔¼¾⅛⅜⅝⅞]?\\s*(?:x\\s*)?)(?:${UNIT}\\b|\\s|$)`, 'i');
const QTY_UNIT_ANYWHERE = new RegExp(`${QTY}\\s*${UNIT}\\b`, 'i');
const SOFT_QTY_START =
  /^(?:a|an|one|two|three|four|five|six|half|some|few|couple|pinch|dash|splash|handful|drizzle|knob|bunch)\b(?:\s+(?:of\s+)?)/i;
const SALT_PEPPER = /^(?:salt|pepper|salt\s*(?:&|and)\s*pepper|oil|olive oil|water|ice)\b.{0,30}$/i;

const STEP_NUMBER = /^(?:step\s*)?(\d{1,2})\s*[.):\-–]\s+(.+)$/i;
const LIST_NUMBER = /^\d{1,2}[.)]\s+/;
const INGREDIENTS_HEADER =
  /^(?:the\s+|main\s+|key\s+)?(?:ingredients?|ingredient list|what you(?:'|’)?ll need|you(?:'|’)?ll need|you will need|shopping list)\b/i;
const STEPS_HEADER =
  /^(?:the\s+)?(?:method|instructions?|directions?|steps?|how to(?: make(?: it| this)?)?|preparation|procedure|to make(?: it)?|recipe steps|let(?:'|’)?s cook|process)\s*[:\-–—]?\s*$/i;
const NOTES_HEADER = /^(?:notes?|tips?|chef(?:'|’)?s (?:note|tip)s?|pro tip|psst|storage|to store|substitutions?)\b\s*[:\-–—]?\s*/i;
const PROMO = /\b(?:comment\b.*\b(?:for|and i)|link in (?:my )?bio|dm (?:me|for)|follow (?:me|@|for)|save (?:this|for later)|full recipe (?:on|at|in)|recipe (?:on|at) (?:my )?(?:blog|website))/i;

// Leading bullets, dashes, check marks and emoji. Keycap digits ("1️⃣") are handled separately.
const LEADING_BULLETS = /^(?:[\s•·▪▫◦●○■□►▶➤➔→✓✔☑*~>\-–—+]|\p{Extended_Pictographic}|️|‍|\p{Emoji_Modifier})+/u;
const TRAILING_EMOJI = /(?:\s|\p{Extended_Pictographic}|️|‍|\p{Emoji_Modifier})+$/u;

function normaliseLine(raw) {
  let line = raw
    .replace(/([0-9])️?⃣/g, '$1. ') // 1️⃣ -> "1. "
    .replace(/ /g, ' ')
    .trim();
  if (!STEP_NUMBER.test(line)) line = line.replace(LEADING_BULLETS, '');
  return line.replace(/\s+/g, ' ').trim();
}

function isHashtagLine(line) {
  return /^(?:[#@][\p{L}\p{N}_.]+[\s,.]*)+$/u.test(line);
}

export function looksLikeIngredient(line) {
  if (!line || line.length > 140) return false;
  const body = line.replace(LIST_NUMBER, '');
  if (QTY_START.test(body)) return true;
  return QTY_UNIT_ANYWHERE.test(body) && body.length <= 90;
}

// "Prep time: 10 min", "Serves 4", "Calories: 450" — read by extractTimes, not part of the lists.
const META_LINE =
  /^(?:(?:prep(?:aration)?|cook(?:ing)?|bake|baking|total|active|rest(?:ing)?)(?:\s*time)?\s*[:\-–—]|(?:serves|servings?|portions?|yields?|makes|feeds)\b\s*[:\-–—]?\s*\d|(?:calories|kcal|macros|protein|carbs|fat)\b.*\d)/i;

function softIngredient(line) {
  // Things like "a pinch of salt", "salt and pepper", "fresh basil" — only trusted inside an ingredients section.
  if (looksLikeIngredient(line)) return true;
  if (line.length > 80) return false;
  if (/[.!?]\s+\p{L}/u.test(line)) return false; // multiple sentences => prose
  return SOFT_QTY_START.test(line) || SALT_PEPPER.test(line) || line.split(' ').length <= 6;
}

/** "SALAD:" / "For the sauce:" / "Nuoc Cham DRESSING:" -> header name, with any inline content after the colon. */
function parseSubHeader(line) {
  const m = line.match(/^([^:]{2,42}):\s*(.*)$/);
  if (m) {
    const name = m[1].trim();
    if (/^\d/.test(name) || /https?$/i.test(name)) return null;
    if (name.split(/\s+/).length > 6) return null;
    return { name, rest: m[2].trim() };
  }
  if (/^for (?:the )?[\p{L}\s&]{2,30}$/iu.test(line)) return { name: line, rest: '' };
  return null;
}

function prettyHeader(name) {
  const base = name.replace(/^for (?:the\s+)?/i, '');
  if (!/\p{Ll}/u.test(base)) return base.toLowerCase().replace(/^\P{L}*\p{L}/u, (c) => c.toUpperCase()).trim();
  return base
    .split(/(\s+)/)
    .map((w) => (/^[A-Z]{2,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join('')
    .replace(/^\p{Ll}/u, (c) => c.toUpperCase())
    .trim();
}

function splitInline(rest) {
  if (!rest) return [];
  const parts = rest.split(/\s*[,;]\s*/).filter(Boolean);
  if (parts.length >= 3 && parts.every((p) => p.length <= 40)) return parts;
  return [rest];
}

const DURATION = '(\\d+(?:[.,]\\d+)?(?:\\s*(?:-|–|to)\\s*\\d+)?\\s*(?:hours?|hrs?|h)\\b(?:\\s*(?:and\\s*)?\\d+\\s*(?:minutes?|mins?|m)\\b)?|\\d+(?:\\s*(?:-|–|to)\\s*\\d+)?\\s*(?:minutes?|mins?|m)\\b)';

function tidyDuration(text) {
  if (!text) return '';
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const hours = t.match(/^(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h)\b(?:\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)\b)?$/);
  if (hours) {
    const minutes = Math.round(parseFloat(hours[1].replace(',', '.')) * 60) + Number(hours[2] || 0);
    return formatMinutes(minutes);
  }
  return t
    .replace(/\s*(?:minutes?|mins?|m)$/, ' min')
    .replace(/\s*(?:hours?|hrs?|h)$/, ' hr')
    .replace(/\s*(?:-|–|to)\s*/, '–');
}

export function extractTimes(text) {
  const find = (re) => {
    const m = text.match(re);
    return m ? tidyDuration(m[1]) : '';
  };
  const servings = text.match(/\b(?:serves|servings?|portions?|yields?|makes|feeds)\b\s*[:\-–]?\s*(?:about\s*)?(\d+(?:\s*(?:-|–|to)\s*\d+)?)/i);
  return {
    prepTime: find(new RegExp(`\\bprep(?:aration)?(?:\\s*time)?\\s*(?::|-|–|—|time)\\s*${DURATION}`, 'i')),
    cookTime: find(new RegExp(`\\b(?:cook|cooking|bake|baking)\\s*(?:time)?\\s*(?::|-|–|—)\\s*${DURATION}`, 'i')),
    totalTime: find(new RegExp(`\\b(?:total(?:\\s*time)?\\s*(?::|-|–|—)?|ready in|done in|takes(?: just| only)?)\\s*${DURATION}`, 'i')),
    servings: servings ? servings[1].replace(/\s*(?:-|–|to)\s*/, '–') : '',
  };
}

export function extractHashtags(text) {
  const tags = [];
  for (const m of text.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const tag = m[1].toLowerCase();
    if (!GENERIC_TAGS.has(tag) && !tags.includes(tag) && tag.length <= 30) tags.push(tag);
  }
  return tags.slice(0, 8);
}

function pickTitle(preLines) {
  const candidates = preLines.filter((l) => !PROMO.test(l) && !isHashtagLine(l));
  // The dish name is usually a short line right before the ingredients.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const l = candidates[i].replace(TRAILING_EMOJI, '').replace(/[:\-–]+$/, '').trim();
    if (l.length >= 3 && l.length <= 60 && !/[!?]$/.test(l) && !/[.]\s/.test(l)) return l;
  }
  const first = (candidates[0] || preLines[0] || '').split(/(?<=[.!?])\s+/)[0] || '';
  const cleaned = first.replace(/#[\p{L}\p{N}_]+/gu, '').replace(TRAILING_EMOJI, '').trim();
  return cleaned.length > 70 ? `${cleaned.slice(0, 67).trimEnd()}…` : cleaned;
}

/**
 * @param {string} caption
 * @returns {{title:string, description:string, ingredients:{group:string, items:string[]}[], steps:string[],
 *   prepTime:string, cookTime:string, totalTime:string, servings:string, notes:string, tags:string[], hasRecipe:boolean}}
 */
export function parseCaption(caption = '') {
  const text = String(caption).replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map(normaliseLine);

  const preLines = [];
  const groups = [];
  const steps = [];
  const notes = [];
  let mode = 'pre';
  let group = null;
  let sawNumberedStep = false;

  const nextContentLine = (i) => {
    for (let j = i + 1; j < lines.length; j++) if (lines[j] && !isHashtagLine(lines[j])) return lines[j];
    return '';
  };
  const startGroup = (name) => {
    group = { group: name ? prettyHeader(name) : '', items: [] };
    groups.push(group);
  };
  const addIngredient = (item) => {
    if (!group) startGroup('');
    group.items.push(item.replace(/[,;]$/, '').trim());
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || isHashtagLine(line) || (META_LINE.test(line) && line.length <= 80)) continue;

    if (STEPS_HEADER.test(line)) {
      mode = 'steps';
      continue;
    }

    const colon = line.indexOf(':');
    if (INGREDIENTS_HEADER.test(line) && (line.length <= 60 || (colon > 0 && colon <= 40))) {
      mode = 'ingredients';
      const inline = colon > 0 ? line.slice(colon + 1).trim() : '';
      const sub = line.slice(0, colon > 0 ? colon : undefined).match(/\bfor (?:the )?(.+?)\s*$/i);
      startGroup(sub ? sub[1] : '');
      splitInline(inline).forEach(addIngredient);
      continue;
    }

    if (NOTES_HEADER.test(line) && mode !== 'pre') {
      mode = 'notes';
      const rest = line.replace(NOTES_HEADER, '').trim();
      if (rest) notes.push(rest);
      continue;
    }

    const numbered = line.match(STEP_NUMBER);
    if (numbered) {
      const body = numbered[2].trim();
      // "1. 200g flour" inside an ingredient list and "1 - 2 cloves garlic" are ingredients, not steps.
      const ingredientish = looksLikeIngredient(body) && (mode === 'ingredients' || QTY_START.test(line));
      if (!ingredientish && body.length > 3) {
        mode = 'steps';
        sawNumberedStep = true;
        steps.push(body);
        continue;
      }
    }

    if (mode === 'notes') {
      notes.push(line);
      continue;
    }

    if (mode === 'steps') {
      const sub = parseSubHeader(line);
      if (sub && !sub.rest) continue; // "Assemble:" style sub-headings
      if (sawNumberedStep && steps.length && /^\p{Ll}/u.test(line)) {
        steps[steps.length - 1] += ` ${line}`;
      } else if (PROMO.test(line) && steps.length) {
        notes.push(line);
      } else {
        steps.push(line);
      }
      continue;
    }

    const header = parseSubHeader(line);
    if (header) {
      const isHeader = header.rest
        ? looksLikeIngredient(header.rest) || (mode === 'ingredients' && softIngredient(header.rest))
        : mode === 'ingredients' || looksLikeIngredient(nextContentLine(i));
      if (isHeader) {
        mode = 'ingredients';
        startGroup(header.name);
        splitInline(header.rest).forEach(addIngredient);
        continue;
      }
    }

    if (mode === 'ingredients') {
      if (!softIngredient(line) && (line.length > 60 || /[.!]$/.test(line))) {
        // Prose after an ingredient list without a "Method" header: treat it as the steps.
        mode = 'steps';
        steps.push(line);
      } else {
        addIngredient(line.replace(LIST_NUMBER, ''));
      }
      continue;
    }

    // mode === 'pre'
    if (QTY_START.test(line) && (QTY_UNIT_ANYWHERE.test(line) || looksLikeIngredient(nextContentLine(i)))) {
      mode = 'ingredients';
      startGroup('');
      addIngredient(line);
      continue;
    }
    preLines.push(line);
  }

  const ingredients = groups.filter((g) => g.items.length);
  const itemCount = ingredients.reduce((n, g) => n + g.items.length, 0);
  const hasRecipe = itemCount >= 2 || (steps.length >= 2 && itemCount >= 1) || steps.length >= 3;

  const title = pickTitle(preLines);
  const description = preLines
    .filter((l) => l !== title && !l.startsWith(title) && !isHashtagLine(l))
    .join(' ')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !PROMO.test(sentence))
    .join(' ')
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);

  return {
    title,
    description,
    ingredients: hasRecipe ? ingredients : [],
    steps: hasRecipe ? steps : [],
    ...extractTimes(text),
    notes: hasRecipe ? notes.join('\n') : '',
    tags: extractHashtags(text),
    hasRecipe,
  };
}
