const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createHash } = require('node:crypto');
process.env.DOTENV_CONFIG_QUIET = 'true';
const { AuthService } = require('../dist/src/auth/auth.service');
const { AuthController } = require('../dist/src/auth/auth.controller');
const { LoginAttemptsService, LOGIN_WINDOW_MS } = require('../dist/src/auth/login-attempts.service');
const { LoginDto } = require('../dist/src/auth/dto/login.dto');
const { ValidationPipe } = require('@nestjs/common');

function setup() {
  const records = new Map();
  const user = { id: 'u', username: 'manager', password: bcrypt.hashSync('correct-password', 4), role: 'admin' };
  let checks = 0;
  const tx = {
    async $executeRaw() {},
    user: { async findUnique({ where }) { checks++; return where.username === user.username ? user : null; } },
    loginAttempt: {
      async findUnique({ where }) { return records.get(where.key) ?? null; },
      async upsert({ where, create, update }) { records.set(where.key, { ...(records.get(where.key) ?? create), ...update }); },
      async deleteMany({ where }) { records.delete(where.key); },
    },
  };
  let queue = Promise.resolve();
  const prisma = { async $transaction(fn) { const task = queue.then(() => fn(tx)); queue = task.catch(() => {}); return task; } };
  const limiter = new LoginAttemptsService(prisma);
  const makeService = () => new AuthService(prisma, { async signAsync() { return 'valid-token'; } }, new LoginAttemptsService(prisma));
  const service = makeService();
  return { records, service, makeService, limiter, checks: () => checks, login: (password = 'wrong', username = 'manager') => service.login({ username, password }) };
}

test('fifth failed password blocks login, including the correct password and a new service instance', async () => {
  const state = setup();
  for (let attempt = 1; attempt <= 4; attempt++) {
    await assert.rejects(state.login(), error => error.getStatus() === 401 && error.getResponse().attemptsRemaining === 5 - attempt);
  }
  await assert.rejects(state.login(), error => error.getStatus() === 429 && error.retryAfter > 0 && error.retryAfter <= 900);
  const checks = state.checks();
  await assert.rejects(state.login('correct-password'), error => error.getStatus() === 429);
  await assert.rejects(state.makeService().login({ username: 'manager', password: 'correct-password' }), error => error.getStatus() === 429);
  assert.equal(state.checks(), checks, 'blocked requests do not even check credentials');
});

test('success clears failures and does not consume a failed attempt', async () => {
  const state = setup();
  for (let i = 0; i < 4; i++) await assert.rejects(state.login());
  assert.equal((await state.login('correct-password')).token, 'valid-token');
  assert.equal(state.records.size, 0);
  await assert.rejects(state.login(), error => error.getResponse().attemptsRemaining === 4);
});

test('timeout restores login and an expired failure window starts a fresh counter', async t => {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  const state = setup();
  await assert.rejects(state.login());
  now += LOGIN_WINDOW_MS + 1;
  await assert.rejects(state.login(), error => error.getResponse().attemptsRemaining === 4);
  for (let i = 0; i < 4; i++) await assert.rejects(state.login());
  now += LOGIN_WINDOW_MS + 1;
  assert.equal((await state.login('correct-password')).token, 'valid-token');
});

test('unknown accounts use the same limit and do not lock another account', async () => {
  const state = setup();
  for (let i = 0; i < 4; i++) await assert.rejects(state.login('wrong', 'unknown'), error => error.getStatus() === 401);
  await assert.rejects(state.login('wrong', 'unknown'), error => error.getStatus() === 429);
  assert.equal((await state.login('correct-password')).token, 'valid-token');
  assert.ok(state.records.has(createHash('sha256').update('unknown').digest('hex')));
});

test('concurrent attempts are counted, and the controller returns Retry-After', async () => {
  const state = setup();
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => state.login()));
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.getStatus() === 401).length, 4);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.getStatus() === 429).length, 6);
  assert.equal(state.checks(), 5);
  const headers = new Map();
  const controller = new AuthController(state.service);
  await assert.rejects(controller.login({ username: 'manager', password: 'correct-password' }, { setHeader: (key, value) => headers.set(key, value) }), error => error.getStatus() === 429);
  assert.ok(headers.get('Retry-After') > 0);
  assert.equal(headers.get('Cache-Control'), 'no-store');
});

test('login rejects empty and oversized credentials', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  for (const dto of [{ username: '', password: 'x' }, { username: '   ', password: 'x' }, { username: 'x', password: '' }, { username: 'x'.repeat(129), password: 'x' }, { username: 'x', password: 'x'.repeat(1025) }]) {
    await assert.rejects(pipe.transform(dto, { type: 'body', metatype: LoginDto }), error => error.getStatus() === 400);
  }
});
