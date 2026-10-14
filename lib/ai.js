// Optional: when ANTHROPIC_API_KEY is set, Claude turns a messy caption into a
// clean recipe (dish name, grouped ingredients, steps, times, servings, tags).
// Without a key the app uses the built-in caption parser instead.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'hasRecipe', 'title', 'description', 'ingredientGroups', 'steps',
    'prepTime', 'cookTime', 'totalTime', 'servings', 'notes', 'tags',
  ],
  properties: {
    hasRecipe: { type: 'boolean' },
    title: { type: 'string' },
    description: { type: 'string' },
    ingredientGroups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'items'],
        properties: {
          name: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
    prepTime: { type: 'string' },
    cookTime: { type: 'string' },
    totalTime: { type: 'string' },
    servings: { type: 'string' },
    notes: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM_PROMPT = `You turn recipe posts from Instagram, TikTok, YouTube and blogs into a clean recipe card for a home cook's personal recipe box.

You get the post's caption (and sometimes a page title). Fill in the JSON fields like this:
- title: the dish name, short and natural ("Vietnamese Chicken Salad"), not the caption's hook line.
- description: one or two sentences about the dish taken from the caption, without calls to action like "comment RECIPE" or "link in bio". Empty if there is nothing useful.
- ingredientGroups: the ingredients exactly as written (keep quantities and units), split into the caption's own groups ("Sauce", "Salad"). Use one group with an empty name when the caption has no groups.
- steps: the method as separate steps, lightly cleaned up (no numbering, no emoji bullets). Keep the creator's wording and details.
- prepTime, cookTime, totalTime, servings: only when the caption states them, written short ("15 min", "1 hr 10 min", "4"). Otherwise empty strings.
- notes: tips, substitutions or storage advice from the caption. Empty if none.
- tags: 2-6 short lowercase tags such as cuisine, meal type and main ingredient ("vietnamese", "salad", "chicken").
- hasRecipe: true only if the caption contains an actual ingredient list or method.

Never invent ingredients, quantities, steps or times that aren't in the text. If the caption has no recipe (e.g. it says the recipe is in the video, in a DM or on a website), set hasRecipe to false, leave the ingredient and step lists empty, and still fill in title, description and tags from what the caption says.`;

let client;

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return client;
}

/**
 * @returns the recipe in the app's shape, or null if Claude declined or returned nothing usable.
 */
export async function structureRecipeWithClaude({ caption, pageTitle = '', platform = '' }) {
  const userText = [
    platform && `Platform: ${platform}`,
    pageTitle && `Page title: ${pageTitle}`,
    `Caption:\n${caption}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    // Retries on Anthropic's recommended model if a safety classifier declines the request.
    ...(MODEL.includes('haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: RECIPE_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  });

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) return null;

  const data = JSON.parse(textBlock.text);
  return {
    title: data.title.trim(),
    description: data.description.trim(),
    ingredients: data.ingredientGroups
      .map((g) => ({ group: g.name.trim(), items: g.items.map((i) => i.trim()).filter(Boolean) }))
      .filter((g) => g.items.length),
    steps: data.steps.map((s) => s.trim()).filter(Boolean),
    prepTime: data.prepTime.trim(),
    cookTime: data.cookTime.trim(),
    totalTime: data.totalTime.trim(),
    servings: data.servings.trim(),
    notes: data.notes.trim(),
    tags: data.tags.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
    hasRecipe: data.hasRecipe,
  };
}
