const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { io } = require('socket.io-client');
require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';
const { PrismaService } = require('../dist/prisma/prisma.service');
const { NotifyService } = require('../dist/src/notify/notify.service');
const { ChatNotifications } = require('../dist/src/chat/chat.notifications');
const { ChatLimiter } = require('../dist/src/chat/chat-validation');

const API = process.env.CHAT_TEST_API_URL || 'http://127.0.0.1:4191';
const FRONT = process.env.CHAT_TEST_FRONTEND_URL || 'http://127.0.0.1:4173';
if (![API, FRONT, process.env.DATABASE_URL].every(value => value && new URL(value).hostname === '127.0.0.1') || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw Error('Use only an isolated loopback test database and servers');
const db = new PrismaService();
const sockets = [];
const conversations = [];
after(async () => {
  sockets.forEach(socket => socket.disconnect());
  await db.chatConversation.deleteMany({ where: { id: { in: conversations } } });
  await db.onModuleDestroy();
});
async function session(name) {
  const response = await fetch(`${API}/api/chat/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, policyAccepted: true, pageUrl: '/catalog?secret=omitted' }) });
  assert.equal(response.status, 201);
  const value = await response.json(); conversations.push(value.conversation.id); return value;
}
function connect(auth, url = FRONT, origin = FRONT) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { path: '/api/chat/socket.io', transports: ['websocket'], auth, extraHeaders: { Origin: origin }, reconnection: false, timeout: 4000 });
    sockets.push(socket); socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject);
  });
}
const call = (socket, event, payload) => socket.timeout(5000).emitWithAck(event, payload);
function onceMessage(socket) { return new Promise(resolve => socket.once('chat:message', resolve)); }

test('real WebSocket conversations: authorization, delivery, retry, history, receipts and durable mail', async () => {
  const a = await session('Проверка А'); const b = await session('Проверка Б');
  assert.equal(a.conversation.pageUrl, '/catalog');
  const login = await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin' }) })).json();
  assert.ok(login.token);
  const visitor = await connect({ token: a.token }); const other = await connect({ token: b.token }); const manager = await connect({ adminToken: login.token });
  assert.equal(visitor.io.engine.transport.name, 'websocket');
  for (const event of ['chat:history', 'chat:read', 'chat:send', 'chat:close']) {
    const denied = await call(other, event, { conversationId: a.conversation.id, through: 1, body: 'No access', clientId: randomUUID() });
    assert.equal(denied.ok, false); assert.equal(denied.code, 403);
  }
  assert.equal((await call(visitor, 'chat:list', {})).code, 403);
  assert.equal((await call(visitor, 'chat:send', { conversationId: a.conversation.id, body: ' ', clientId: randomUUID() })).code, 400);
  assert.equal((await call(visitor, 'chat:send', { conversationId: a.conversation.id, body: 'a'.repeat(4001), clientId: randomUUID() })).code, 400);
  let leaked = false; other.on('chat:message', () => { leaked = true; });
  const firstDelivery = onceMessage(manager);
  const payload = { conversationId: a.conversation.id, body: 'Нужны рельсы Р65 <script>test</script>', clientId: randomUUID() };
  const [sent, retry] = await Promise.all([call(visitor, 'chat:send', payload), call(visitor, 'chat:send', payload)]);
  assert.equal(sent.ok, true); assert.equal(retry.data.id, sent.data.id);
  assert.equal((await firstDelivery).id, sent.data.id);
  assert.equal(await db.chatMessage.count({ where: { conversationId: a.conversation.id } }), 1);
  const inbox = await call(manager, 'chat:list', {});
  assert.equal(inbox.data.items.find(item => item.id === a.conversation.id).unread, 1);
  assert.ok(!JSON.stringify(inbox).includes('tokenHash'));
  const incoming = onceMessage(visitor);
  const reply = await call(manager, 'chat:send', { conversationId: a.conversation.id, body: 'Уточните объём поставки', clientId: randomUUID() });
  assert.equal((await incoming).id, reply.data.id);
  const read = await call(visitor, 'chat:read', { conversationId: a.conversation.id, through: reply.data.id }); assert.equal(read.ok, true);
  assert.ok((await db.chatMessage.findUnique({ where: { id: reply.data.id } })).readAt);
  await call(manager, 'chat:read', { conversationId: a.conversation.id, through: sent.data.id });
  assert.equal((await call(manager, 'chat:list', {})).data.items.find(item => item.id === a.conversation.id).unread, 0);
  visitor.disconnect();
  const resumed = await connect({ token: a.token });
  const history = await call(resumed, 'chat:history', { conversationId: a.conversation.id });
  assert.equal(history.data.messages.length, 2); assert.equal(history.data.messages[0].body, payload.body);
  await call(manager, 'chat:close', { conversationId: a.conversation.id });
  assert.equal((await call(resumed, 'chat:history', { conversationId: a.conversation.id })).data.conversation.closed, true);
  await call(resumed, 'chat:send', { conversationId: a.conversation.id, body: '20 тонн', clientId: randomUUID() });
  assert.equal((await call(resumed, 'chat:history', { conversationId: a.conversation.id })).data.conversation.closed, false);
  assert.equal(leaked, false);
  await assert.rejects(connect({ token: '0'.repeat(64) }));
  await assert.rejects(connect({ token: a.token }, API, 'https://untrusted.example'));

  const notify = new NotifyService(); const delivered = [];
  notify.logger = { error() {}, warn() {}, log() {} };
  notify.to = 'local-test@example.invalid'; notify.from = { name: 'Test', address: 'test@example.invalid' }; notify.siteUrl = FRONT;
  notify.transport = { async sendMail() { throw Error('SMTP temporarily unavailable'); } };
  // Keep the real database/worker, but scope its queue to this test's conversation.
  // Browser smoke tests can leave pending messages in the shared local test database.
  const mailDb = { chatMessage: {
    findMany: args => db.chatMessage.findMany({ ...args, where: { AND: [args.where, { conversationId: a.conversation.id }] } }),
    updateMany: args => db.chatMessage.updateMany(args),
    update: args => db.chatMessage.update(args),
  } };
  const unrelated = await db.chatMessage.create({ data: {
    conversationId: b.conversation.id, sender: 'VISITOR', clientId: randomUUID(),
    body: 'An unrelated pending notification must remain untouched', notificationDueAt: new Date(0),
  } });
  const worker = new ChatNotifications(mailDb, notify);
  await worker.flush();
  let stored = await db.chatMessage.findUnique({ where: { id: sent.data.id } });
  assert.equal(stored.notificationSentAt, null); assert.equal(stored.notificationTries, 1); assert.ok(stored.notificationDueAt > new Date());
  await db.chatMessage.updateMany({ where: { conversationId: a.conversation.id, sender: 'VISITOR' }, data: { notificationDueAt: new Date(0) } });
  notify.transport = { async sendMail(message) { delivered.push(message); } };
  await new ChatNotifications(mailDb, notify).flush();
  stored = await db.chatMessage.findUnique({ where: { id: sent.data.id } });
  assert.ok(stored.notificationSentAt); assert.equal(stored.notificationTries, 2);
  assert.equal(delivered.length, 2); assert.ok(delivered[0].text.includes(`/admin/chats?conversation=${a.conversation.id}`));
  await worker.flush(); assert.equal(delivered.length, 2);
  const untouched = await db.chatMessage.findUnique({ where: { id: unrelated.id } });
  assert.equal(untouched.notificationTries, 0); assert.equal(untouched.notificationSentAt, null);
  await db.chatMessage.delete({ where: { id: unrelated.id } });
  assert.equal((await db.chatMessage.findUnique({ where: { id: reply.data.id } })).notificationDueAt, null);
  await db.chatMessage.createMany({ data: Array.from({ length: 55 }, (_, index) => ({ conversationId: b.conversation.id, sender: 'MANAGER', clientId: randomUUID(), body: `История ${index}` })) });
  const newest = await call(other, 'chat:history', { conversationId: b.conversation.id });
  assert.equal(newest.data.messages.length, 50); assert.equal(newest.data.hasMore, true);
  const oldest = await call(other, 'chat:history', { conversationId: b.conversation.id, before: newest.data.messages[0].id });
  assert.equal(oldest.data.messages.length, 5); assert.equal(oldest.data.hasMore, false);
  assert.equal(new Set([...oldest.data.messages, ...newest.data.messages].map(message => message.id)).size, 55);
  await call(other, 'chat:read', { conversationId: b.conversation.id, through: oldest.data.messages.at(-1).id });
  assert.equal(await db.chatMessage.count({ where: { conversationId: b.conversation.id, readAt: null } }), 50);
  const limiter = new ChatLimiter(); limiter.check('test', 1, 1000); assert.throws(() => limiter.check('test', 1, 1000), /Слишком много/);
});
