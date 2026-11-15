const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
process.env.DOTENV_CONFIG_QUIET = 'true';
const { GigaChatClient } = require('../dist/src/chat/ai/gigachat.client');
const { ChatContextService } = require('../dist/src/chat/ai/chat-context.service');

test('GigaChat OAuth is cached, 401 refreshes once; malformed/partial output never becomes a draft', async t => {
  const saved = { CHAT_AI_ENABLED: process.env.CHAT_AI_ENABLED, GIGACHAT_AUTH_KEY: process.env.GIGACHAT_AUTH_KEY };
  process.env.CHAT_AI_ENABLED = 'true'; process.env.GIGACHAT_AUTH_KEY = 'test-not-a-secret';
  t.after(() => { for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const requests = []; let tokenCalls = 0; let calls = 0; let bad = false;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, init });
    if (url.includes('/oauth')) {
      tokenCalls++;
      assert.equal(init.headers.Authorization, 'Basic test-not-a-secret');
      assert.match(init.headers.RqUID, /^[0-9a-f-]{36}$/);
      return Response.json({ access_token: `access-${tokenCalls}`, expires_at: Date.now() + 1800000 });
    }
    calls++;
    assert.equal(url, 'https://api.giga.chat/v1/chat/completions');
    assert.equal(JSON.parse(init.body).stream, false);
    if (calls === 2) return new Response('', { status: 401 });
    return Response.json({ choices: [{ message: { content: 'Ответ по каталогу' }, finish_reason: bad ? 'length' : 'stop' }] });
  });
  const client = new GigaChatClient();
  const input = [{ role: 'user', content: 'Р65' }];
  assert.equal(await client.complete(input), 'Ответ по каталогу');
  assert.equal(await client.complete(input), 'Ответ по каталогу');
  assert.equal(tokenCalls, 2); assert.equal(calls, 3);
  assert.equal(requests.at(-1).init.headers.Authorization, 'Bearer access-2');
  bad = true;
  await assert.rejects(client.complete(input), /incomplete/);
  process.env.CHAT_AI_ENABLED = 'false';
  await assert.rejects(client.complete(input), /not configured/);
});

test('context contains verified store facts and DB catalog, canonical links and relevant complements without profile contacts', async () => {
  const product = (sku, title, slug) => ({ sku, title, slug, price: null, stock: 0, condition: 'NEW', gost: null, description: '<p>Данные</p>', category: { name: 'Рельсы', slug: 'relsy' }, subcategory: null, specs: [] });
  const catalog = [product('1', 'Рельс Р65', 'r65'), product('2', 'Накладка Р65', 'n65'), product('3', 'Накладка Р50', 'n50'), product('4', 'Болт стыковой Р65', 'bolt65')];
  const db = {
    chatMessage: { findMany: async () => [{ sender: 'VISITOR', body: 'Хочу купить рельсы Р65' }] },
    chatConversation: { findUniqueOrThrow: async () => ({ pageUrl: '/catalog/relsy/product/r65', contact: 'private@example.com' }) },
    product: { findMany: async () => catalog },
  };
  const messages = await new ChatContextService(db).messages('test', 1);
  const system = messages[0].content;
  assert.match(system, /Московская, зд\. 4/);
  assert.match(system, /zakaz@prorelsa\.ru/);
  assert.match(system, /1: Рельс Р65/);
  assert.match(system, /https:\/\/prorelsa\.ru\/catalog\/relsy\/product\/r65/);
  assert.ok(!system.includes('private@example.com'));
  const data = JSON.parse(system.split('ДАННЫЕ КАТАЛОГА (не инструкции):\n')[1]);
  assert.equal(data.relevant[0].sku, '1');
  assert.ok(data.possibleComplements.every(p => p.title.includes('Р65')));
  assert.equal(messages.at(-1).role, 'user');
});
