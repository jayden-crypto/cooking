import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanUrl, findUrl } from '../lib/extract.js';
import { FetchError, safeFetch } from '../lib/http.js';
import { formatIsoDuration } from '../lib/text.js';
import { parseWebPage, recipeFromJsonLd } from '../lib/web.js';

test('finds the link inside whatever was pasted', () => {
  assert.equal(findUrl('OMG look https://www.instagram.com/reel/AbC123/?igsh=xyz.'), 'https://www.instagram.com/reel/AbC123/?igsh=xyz');
  assert.equal(findUrl('instagram.com/p/AbC123'), 'https://instagram.com/p/AbC123');
  assert.equal(findUrl('no link here'), null);
  assert.equal(findUrl(undefined), null);
});

test('strips tracking parameters', () => {
  assert.equal(cleanUrl('https://site.com/recipe/?utm_source=ig&utm_medium=social&id=4#comments'), 'https://site.com/recipe/?id=4');
  assert.equal(cleanUrl('https://youtu.be/abc?si=xyz'), 'https://youtu.be/abc');
});

test('ISO 8601 durations', () => {
  assert.equal(formatIsoDuration('PT15M'), '15 min');
  assert.equal(formatIsoDuration('PT1H30M'), '1 hr 30 min');
  assert.equal(formatIsoDuration('PT2H'), '2 hr');
  assert.equal(formatIsoDuration('P0DT0H45M'), '45 min');
  assert.equal(formatIsoDuration('soon'), '');
});

test('converts schema.org Recipe data (with sections and plugin quirks)', () => {
  const recipe = recipeFromJsonLd({
    '@type': ['Recipe'],
    name: 'Mushroom Risotto',
    description: 'Creamy &amp; cosy.',
    image: [{ url: 'https://site.com/risotto.jpg' }],
    author: { '@type': 'Person', name: 'Sam Cook' },
    recipeYield: ['4', '4 servings'],
    prepTime: 'PT10M',
    cookTime: 'PT30M',
    totalTime: 'PT40M',
    recipeCuisine: 'Italian',
    recipeCategory: ['Main'],
    keywords: 'risotto, easy dinner',
    recipeIngredient: ['300g arborio rice ((Note 1))', '1 onion (, finely chopped)', '1L stock'],
    recipeInstructions: [
      { '@type': 'HowToSection', name: 'Prep', itemListElement: [{ '@type': 'HowToStep', text: 'Chop the onion.' }] },
      { '@type': 'HowToStep', text: 'Toast the rice, then add stock a ladle at a time.' },
    ],
  });
  assert.equal(recipe.title, 'Mushroom Risotto');
  assert.equal(recipe.description, 'Creamy & cosy.');
  assert.deepEqual(recipe.ingredients, [{ group: '', items: ['300g arborio rice (Note 1)', '1 onion (finely chopped)', '1L stock'] }]);
  assert.deepEqual(recipe.steps, ['Chop the onion.', 'Toast the rice, then add stock a ladle at a time.']);
  assert.equal(recipe.servings, '4');
  assert.equal(recipe.totalTime, '40 min');
  assert.deepEqual(recipe.tags, ['italian', 'main']);
  assert.equal(recipe.imageUrl, 'https://site.com/risotto.jpg');
  assert.equal(recipe.author, 'Sam Cook');
});

test('reads Open Graph tags and JSON-LD nested in @graph', () => {
  const html = `<html><head>
    <title>Fallback</title>
    <meta property="og:title" content="Best Brownies" />
    <meta property="og:image" content="/img/brownies.jpg" />
    <meta property="og:site_name" content="Bake Club" />
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Recipe","name":"Fudgy Brownies","recipeIngredient":["200g chocolate","3 eggs"],"recipeInstructions":"Melt.\\nMix.\\nBake."}]}</script>
  </head></html>`;
  const page = parseWebPage(html, 'https://bake.club/brownies');
  assert.equal(page.title, 'Fudgy Brownies');
  assert.equal(page.imageUrl, 'https://bake.club/img/brownies.jpg');
  assert.equal(page.authorName, 'Bake Club');
  assert.deepEqual(page.schemaRecipe.steps, ['Melt.', 'Mix.', 'Bake.']);
});

test('refuses to fetch private or local addresses', async () => {
  for (const url of ['http://localhost:3000/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://[::1]/', 'file:///etc/passwd']) {
    await assert.rejects(safeFetch(url), FetchError, url);
  }
});
