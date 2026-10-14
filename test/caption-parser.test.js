import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractTimes, looksLikeIngredient, parseCaption } from '../lib/caption-parser.js';

test('reads grouped ingredients, numbered steps and notes (typical recipe-creator caption)', () => {
  const caption = [
    'Best noodles of the summer! 😍 Comment NOODLES and I’ll DM you the link, or see below 👇',
    '',
    'Sesame Chilli Noodles',
    ' ',
    'NOODLES:',
    '200g/7oz dried wheat noodles',
    '2 spring onions, finely sliced (green parts only)',
    '1 small cucumber, cut into thin matchsticks',
    'SPICY SESAME SAUCE:',
    '3 tbsp EACH soy sauce, black vinegar',
    '2 tbsp tahini',
    '1 tsp chilli oil, or more to taste',
    'TOPPING (DON’T SKIP!): 2 tbsp toasted sesame seeds',
    ' ',
    '1. Cook the noodles per the packet, then rinse under cold water and drain well.',
    '2. Whisk the Sauce, toss through the noodles with the cucumber.',
    'Top with spring onion and sesame seeds.',
    '',
    'Note: Keeps 2 days in the fridge, add the cucumber just before serving.',
    '#noodles #recipe #easyrecipes #sesame',
  ].join('\n');

  const r = parseCaption(caption);
  assert.equal(r.title, 'Sesame Chilli Noodles');
  assert.equal(r.hasRecipe, true);
  assert.deepEqual(
    r.ingredients.map((g) => g.group),
    ['Noodles', 'Spicy sesame sauce', 'Topping (don’t skip!)'],
  );
  assert.equal(r.ingredients[0].items.length, 3);
  assert.equal(r.ingredients[1].items[0], '3 tbsp EACH soy sauce, black vinegar');
  assert.deepEqual(r.ingredients[2].items, ['2 tbsp toasted sesame seeds']);
  assert.equal(r.steps.length, 3);
  assert.match(r.steps[0], /^Cook the noodles/);
  assert.equal(r.notes, 'Keeps 2 days in the fridge, add the cucumber just before serving.');
  assert.deepEqual(r.tags, ['noodles', 'sesame']);
  assert.doesNotMatch(r.description, /Comment NOODLES/);
});

test('handles "Ingredients:" / "Method:" headers, emoji bullets, keycap numbers, times and servings', () => {
  const caption = [
    'Crispy garlic butter potatoes 🥔',
    'Serves 4 | Prep: 10 mins | Cook time: 45 minutes',
    '',
    'Ingredients',
    '🔸 1kg baby potatoes',
    '🔸 3 tbsp butter, melted',
    '🔸 4 garlic cloves, minced',
    '🔸 Salt and pepper',
    '🔸 Fresh parsley',
    '',
    'Method',
    '1️⃣ Boil the potatoes for 15 minutes until just tender.',
    '2️⃣ Smash them flat on a tray, brush with garlic butter.',
    '3️⃣ Roast at 220C for 30 minutes until golden.',
  ].join('\n');

  const r = parseCaption(caption);
  assert.equal(r.title, 'Crispy garlic butter potatoes');
  assert.equal(r.servings, '4');
  assert.equal(r.prepTime, '10 min');
  assert.equal(r.cookTime, '45 min');
  assert.deepEqual(r.ingredients, [
    { group: '', items: ['1kg baby potatoes', '3 tbsp butter, melted', '4 garlic cloves, minced', 'Salt and pepper', 'Fresh parsley'] },
  ]);
  assert.deepEqual(r.steps, [
    'Boil the potatoes for 15 minutes until just tender.',
    'Smash them flat on a tray, brush with garlic butter.',
    'Roast at 220C for 30 minutes until golden.',
  ]);
});

test('finds ingredients without any header and treats the prose after them as steps', () => {
  const caption = [
    'Lemon pasta in 15 minutes',
    '',
    '250g spaghetti',
    '1 lemon, zest and juice',
    '50g parmesan, grated',
    '2 tbsp butter',
    '',
    'Cook the pasta in salted water. Save a cup of the pasta water before draining.',
    'Melt the butter with the lemon zest, add the pasta, juice, parmesan and a splash of the water. Toss until glossy.',
  ].join('\n');

  const r = parseCaption(caption);
  assert.equal(r.title, 'Lemon pasta in 15 minutes');
  assert.equal(r.ingredients[0].items.length, 4);
  assert.equal(r.steps.length, 2);
  assert.equal(r.hasRecipe, true);
});

test('splits a one-line inline ingredient list', () => {
  const r = parseCaption('Easy pancakes\nIngredients: 1 cup flour, 1 egg, 1 cup milk, pinch of salt\nWhisk everything and fry in a hot buttered pan until golden.');
  assert.deepEqual(r.ingredients[0].items, ['1 cup flour', '1 egg', '1 cup milk', 'pinch of salt']);
  assert.equal(r.steps.length, 1);
});

test('reports no recipe for captions without one', () => {
  const r = parseCaption('Recipe for this one is in the video 🎥 Comment BREAD and I’ll send it to you! #bread #baking');
  assert.equal(r.hasRecipe, false);
  assert.deepEqual(r.ingredients, []);
  assert.deepEqual(r.steps, []);
  assert.deepEqual(r.tags, ['bread', 'baking']);
});

test('ingredient detection', () => {
  for (const line of ['200g flour', '1/2 cup milk', '½ tsp salt', '2 eggs', '1 - 2 cloves garlic', '1.5 cups stock', '3 large carrots, peeled']) {
    assert.equal(looksLikeIngredient(line), true, line);
  }
  for (const line of ['Preheat the oven to 200C', 'So good!', '1. Preheat the oven']) {
    assert.equal(looksLikeIngredient(line), false, line);
  }
});

test('time parsing', () => {
  assert.deepEqual(extractTimes('Prep time: 15 min. Cook: 1 hour 10 minutes. Makes 12 cookies'), {
    prepTime: '15 min',
    cookTime: '1 hr 10 min',
    totalTime: '',
    servings: '12',
  });
  assert.equal(extractTimes('Ready in 30 minutes!').totalTime, '30 min');
  assert.equal(extractTimes('just cook it for 5 minutes').cookTime, '');
});
