const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { io } = require('socket.io-client');
const { boot } = require('./chat-ai-server.cjs');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { ChatService } = require('../dist/src/chat/chat.service');
const { ChatAiService } = require('../dist/src/chat/ai/chat-ai.service');
const { ChatContextService } = require('../dist/src/chat/ai/chat-context.service');
const { ChatEvents } = require('../dist/src/chat/chat.events');
const { JwtService } = require('@nestjs/jwt');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(40); }
  throw Error('Timed out waiting for test condition');
}

test('AI lifecycle over real WebSocket and PostgreSQL', { timeout: 65000 }, async t => {
  const { app, provider, url } = await boot();
  const db = app.get(PrismaService); const chat = app.get(ChatService); const worker = app.get(ChatAiService);
  const ids = [], sockets = [];
  const user = await db.user.create({ data: { username: `ai-test-${randomUUID()}`, password: 'unused-test-only', role: 'admin' } });
  const token = await app.get(JwtService).signAsync({ sub: user.id }, { secret: process.env.JWT_SECRET, expiresIn: '1h' });
  const originalComplete = provider.complete;
  t.after(async () => {
    sockets.forEach(s => s.disconnect());
    worker.onModuleDestroy();
    await db.chatConversation.deleteMany({ where: { id: { in: ids } } });
    await db.user.delete({ where: { id: user.id } });
    await app.close();
  });
  const connect = auth => new Promise((resolve, reject) => {
    const socket = io(url, { path: '/api/chat/socket.io', transports: ['websocket'], auth, reconnection: false });
    sockets.push(socket); socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject);
  });
  const raw = (socket, event, data) => socket.timeout(5000).emitWithAck(event, data);
  const call = async (socket, event, data) => { const result = await raw(socket, event, data); assert.equal(result.ok, true, JSON.stringify(result)); return result.data; };
  const manager = await connect({ adminToken: token });
  const fresh = async () => {
    const session = await chat.createSession({ name: 'AI integration', policyAccepted: true, pageUrl: '/catalog' }, randomUUID());
    ids.push(session.conversation.id);
    return { id: session.conversation.id, visitor: await connect({ token: session.token }) };
  };
  const send = (socket, id, body, clientId = randomUUID()) => call(socket, 'chat:send', { conversationId: id, body, clientId });
  const state = id => db.chatAiDraft.findUnique({ where: { conversationId: id } });
  const pending = id => until(async () => { const d = await state(id); return d?.status === 'PENDING' && d; });
  const count = id => db.chatMessage.count({ where: { conversationId: id, sender: 'AI' } });

  await t.test('draft is private, review lasts 7 seconds, duplicate sends/competing workers deliver only once, AI receipts work', async () => {
    const { id, visitor } = await fresh(); let leaked = false; visitor.on('chat:ai', () => { leaked = true; });
    const clientId = randomUUID();
    const [one, retry] = await Promise.all([send(visitor, id, 'Купить рельсы Р65', clientId), send(visitor, id, 'Купить рельсы Р65', clientId)]);
    assert.equal(one.id, retry.id);
    const draft = await pending(id);
    const visible = await call(manager, 'chat:history', { conversationId: id });
    assert.equal(visible.conversation.ai.draft.body, draft.body);
    const privateHistory = await call(visitor, 'chat:history', { conversationId: id });
    assert.ok(!('ai' in privateHistory.conversation));
    assert.equal(privateHistory.messages.length, 1);
    for (const event of ['chat:ai:mode', 'chat:ai:cancel']) assert.equal((await raw(visitor, event, { conversationId: id, enabled: false, draftId: draft.id })).code, 403);
    await sleep(6300);
    assert.equal(await count(id), 0);
    const secondWorker = new ChatAiService(db, provider, app.get(ChatContextService), app.get(ChatEvents));
    await until(async () => { await Promise.all([worker.tick(), secondWorker.tick()]); return (await count(id)) === 1; }, 2500);
    await Promise.all([worker.tick(), secondWorker.tick()]);
    assert.equal(await count(id), 1);
    const message = await db.chatMessage.findFirst({ where: { conversationId: id, sender: 'AI' } });
    assert.ok(message.createdAt.getTime() >= draft.sendAt.getTime());
    assert.ok(draft.sendAt.getTime() - draft.updatedAt.getTime() >= 6990);
    assert.equal(message.notificationDueAt, null);
    await call(manager, 'chat:read', { conversationId: id, through: message.id });
    assert.equal((await db.chatMessage.findUnique({ where: { id: message.id } })).readAt, null);
    await call(visitor, 'chat:read', { conversationId: id, through: message.id });
    assert.ok((await db.chatMessage.findUnique({ where: { id: message.id } })).readAt);
    assert.equal(leaked, false);
    assert.equal((await raw(manager, 'chat:ai:cancel', { conversationId: id, draftId: draft.id })).code, 409);
  });

  await t.test('cancel near the deadline pauses future AI replies; manual reply and explicit request for a person also pause', async () => {
    const { id, visitor } = await fresh();
    await send(visitor, id, 'Есть рельсы?'); const draft = await pending(id);
    await sleep(6100);
    await call(manager, 'chat:ai:cancel', { conversationId: id, draftId: draft.id });
    await sleep(1100); await worker.tick(); assert.equal(await count(id), 0);
    await send(visitor, id, 'Нужно 20 тонн'); assert.equal((await state(id)).status, 'CANCELLED');
    await call(manager, 'chat:ai:mode', { conversationId: id, enabled: true }); await pending(id);
    await send(manager, id, 'Подключился менеджер');
    assert.equal((await state(id)).status, 'CANCELLED');
    assert.equal((await db.chatConversation.findUnique({ where: { id } })).aiEnabled, false);
    await call(manager, 'chat:ai:mode', { conversationId: id, enabled: true });
    await send(visitor, id, 'Позовите менеджера');
    assert.equal((await db.chatConversation.findUnique({ where: { id } })).aiEnabled, false);
  });

  await t.test('takeover and new visitor messages invalidate an in-flight completion; closed chats never send', async () => {
    const { id, visitor } = await fresh(); let release;
    provider.complete = () => new Promise(resolve => { release = resolve; });
    await send(visitor, id, 'Первый вопрос'); await until(() => release);
    await call(manager, 'chat:ai:mode', { conversationId: id, enabled: false }); release('Устаревший ответ');
    await until(() => worker.generating === 0);
    assert.equal((await state(id)).status, 'CANCELLED');
    release = undefined;
    await call(manager, 'chat:ai:mode', { conversationId: id, enabled: true }); await until(() => release);
    await send(visitor, id, 'Новый вопрос');
    provider.complete = originalComplete; release('Ещё один устаревший ответ');
    const draft = await pending(id);
    assert.match(draft.body, /Новый вопрос/); assert.ok(!draft.body.includes('устаревший'));
    await call(manager, 'chat:close', { conversationId: id });
    assert.equal((await state(id)).status, 'CANCELLED'); assert.equal(await count(id), 0);
  });

  await t.test('provider failure and missing credentials leave human chat usable without fake answers', async () => {
    const { id, visitor } = await fresh();
    provider.complete = async () => { throw Error('provider failure secret detail'); };
    await send(visitor, id, 'Ошибка провайдера');
    await until(async () => (await state(id))?.status === 'FAILED');
    assert.ok(!(await state(id)).error.includes('secret'));
    assert.equal(await count(id), 0);
    await send(manager, id, 'Я помогу с заказом');
    provider.configured = false; provider.complete = originalComplete;
    const other = await fresh(); await send(other.visitor, other.id, 'Без ключа');
    assert.equal(await state(other.id), null);
    assert.equal((await raw(manager, 'chat:ai:mode', { conversationId: other.id, enabled: true })).code, 409);
    await send(manager, other.id, 'Обычный чат работает'); provider.configured = true;
  });

  await t.test('pending draft survives worker restart and is sent exactly once after its stored deadline', async () => {
    const { id, visitor } = await fresh(); await send(visitor, id, 'После перезапуска'); const draft = await pending(id);
    worker.onModuleDestroy();
    const restarted = new ChatAiService(db, provider, app.get(ChatContextService), app.get(ChatEvents));
    await restarted.tick(); assert.equal(await count(id), 0);
    await sleep(Math.max(0, draft.sendAt.getTime() - Date.now()) + 30);
    await restarted.tick(); await restarted.tick(); assert.equal(await count(id), 1);
  });
});
