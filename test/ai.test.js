// Checks the Claude request we send and how the answer is read, against a
// local stand-in for the API (no real key or network needed).

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

let server;
let lastRequest;
let reply;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

after(() => server.close());

const message = (content, stop_reason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

test('sends the caption with a JSON schema and reads the structured recipe', async () => {
  const { structureRecipeWithClaude, aiEnabled } = await import('../lib/ai.js');
  assert.equal(aiEnabled(), true);
  reply = message([
    { type: 'thinking', thinking: '', signature: 'sig' },
    {
      type: 'text',
      text: JSON.stringify({
        hasRecipe: true,
        title: ' Vietnamese Chicken Salad ',
        description: 'A crunchy salad.',
        ingredientGroups: [{ name: 'Salad', items: ['350g chicken', ' '] }, { name: 'Empty', items: [] }],
        steps: ['Toss everything.'],
        prepTime: '15 min',
        cookTime: '',
        totalTime: '',
        servings: '4',
        notes: '',
        tags: ['Vietnamese', 'salad'],
      }),
    },
  ]);

  const recipe = await structureRecipeWithClaude({ caption: 'SALAD:\n350g chicken', platform: 'instagram' });

  assert.equal(lastRequest.url, '/v1/messages?beta=true');
  assert.equal(lastRequest.body.model, 'claude-opus-5-5');
  assert.equal(lastRequest.body.fallbacks, 'default');
  assert.match(lastRequest.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(lastRequest.body.output_config.format.type, 'json_schema');
  assert.equal(lastRequest.body.output_config.effort, 'low');
  assert.match(lastRequest.body.messages[0].content, /350g chicken/);

  assert.deepEqual(recipe, {
    title: 'Vietnamese Chicken Salad',
    description: 'A crunchy salad.',
    ingredients: [{ group: 'Salad', items: ['350g chicken'] }],
    steps: ['Toss everything.'],
    prepTime: '15 min',
    cookTime: '',
    totalTime: '',
    servings: '4',
    notes: '',
    tags: ['vietnamese', 'salad'],
    hasRecipe: true,
  });
});

test('returns null when Claude declines', async () => {
  const { structureRecipeWithClaude } = await import('../lib/ai.js');
  reply = message([], 'refusal');
  assert.equal(await structureRecipeWithClaude({ caption: 'anything' }), null);
});
