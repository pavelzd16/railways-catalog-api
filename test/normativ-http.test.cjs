// Контроллер /api/normativ через Nest + настоящий JwtAuthGuard: доступ, порядок маршрутов, загрузка PDF.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.JWT_SECRET = 'normativ-test-secret';
require('reflect-metadata');
const request = require('supertest');
const { Module, NotFoundException, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { NormativController } = require('../dist/src/normativ/normativ.controller');
const { NormativService } = require('../dist/src/normativ/normativ.service');
const { JwtStrategy } = require('../dist/src/auth/jwt.strategy');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { MulterExceptionFilter } = require('../dist/src/common/multer-exception.filter');

const MB = 1024 * 1024;
const calls = [];
const fakeService = {
  async findPublished() { calls.push(['findPublished']); return { items: [] }; },
  async findAllAdmin() { calls.push(['findAllAdmin']); return { items: [] }; },
  async findOneById(id) { calls.push(['findOneById', id]); return { id }; },
  async findOneBySlug(slug) { calls.push(['findOneBySlug', slug]); if (slug === 'net') throw new NotFoundException(); return { slug }; },
  async create(dto) { calls.push(['create', dto]); return { id: 'new' }; },
  async update(id, dto) { calls.push(['update', id, dto]); return { id }; },
  async setFile(id, file, fileName) { calls.push(['setFile', id, file.originalname, file.size, fileName]); return { id, hasFile: true }; },
  async setPreviews(id, files, pageCount) { calls.push(['setPreviews', id, files.map((f) => f.originalname), pageCount]); return { id, pageCount }; },
  async appendPreviews(id, files, pageCount) { calls.push(['appendPreviews', id, files.map((f) => f.originalname), pageCount]); return { id, pageCount }; },
  async delete(id) { calls.push(['delete', id]); },
};

class TestModule {}
Module({
  controllers: [NormativController],
  providers: [
    { provide: NormativService, useValue: fakeService },
    { provide: PrismaService, useValue: { user: { async findUnique() { return { id: 'u1', username: 'admin' }; } } } },
    JwtStrategy,
  ],
})(TestModule);

let app;
let auth;
before(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  // Как в src/main.ts.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new MulterExceptionFilter());
  await app.init();
  auth = `Bearer ${new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: 'u1', username: 'admin' })}`;
});
after(() => app?.close());

const server = () => app.getHttpServer();
const pdf = Buffer.from('%PDF-1.7\n%test\n');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const dto = { code: 'ГОСТ 4121-96', name: 'Рельсы крановые', kind: 'gost', status: 'active', scope: 'Краны', title: 'T', description: 'D', h1: 'H', body: '<p>a</p>', weight: 'main' };

test('публичные GET без токена: список и документ; нет документа — 404', async () => {
  await request(server()).get('/api/normativ').expect(200, { items: [] });
  const res = await request(server()).get('/api/normativ/gost-4121-96').expect(200);
  assert.equal(res.body.slug, 'gost-4121-96');
  await request(server()).get('/api/normativ/net').expect(404);
});

test('админские адреса и запись без токена -> 401, сервис не вызывается', async () => {
  calls.length = 0;
  await request(server()).get('/api/normativ/admin/list').expect(401);
  await request(server()).get('/api/normativ/admin/abc').expect(401);
  await request(server()).post('/api/normativ').send(dto).expect(401);
  await request(server()).put('/api/normativ/abc').send({ name: 'x' }).expect(401);
  await request(server()).put('/api/normativ/abc/file').attach('file', pdf, 'a.pdf').expect(401);
  await request(server()).put('/api/normativ/abc/previews').field('pageCount', '9').attach('images', png, 'a-1.png').expect(401);
  await request(server()).post('/api/normativ/abc/previews').attach('images', png, 'a-4.png').expect(401);
  await request(server()).delete('/api/normativ/abc').expect(401);
  await request(server()).get('/api/normativ/admin/list').set('Authorization', 'Bearer bad.token.value').expect(401);
  assert.deepEqual(calls, []);
});

test('с токеном: admin/list и admin/:id не перехватываются маршрутом :slug; POST, PUT, DELETE доходят', async () => {
  calls.length = 0;
  await request(server()).get('/api/normativ/admin/list').set('Authorization', auth).expect(200);
  await request(server()).get('/api/normativ/admin/abc').set('Authorization', auth).expect(200);
  await request(server()).post('/api/normativ').set('Authorization', auth).send(dto).expect(201);
  await request(server()).put('/api/normativ/abc').set('Authorization', auth).send({ name: 'Новое' }).expect(200);
  await request(server()).delete('/api/normativ/abc').set('Authorization', auth).expect(204);
  assert.deepEqual(calls.map((c) => c[0]), ['findAllAdmin', 'findOneById', 'create', 'update', 'delete']);
});

test('POST: лишнее поле (file) и чужой тип документа -> 400', async () => {
  await request(server()).post('/api/normativ').set('Authorization', auth).send({ ...dto, file: '/uploads/x.pdf' }).expect(400);
  await request(server()).post('/api/normativ').set('Authorization', auth).send({ ...dto, kind: 'din' }).expect(400);
});

test('PUT /:id/file принимает PDF с русским именем и полем fileName', async () => {
  calls.length = 0;
  await request(server())
    .put('/api/normativ/abc/file').set('Authorization', auth)
    .field('fileName', 'ГОСТ 4121-96.pdf')
    .attach('file', pdf, 'ГОСТ 4121-96 скан.pdf')
    .expect(200);
  assert.deepEqual(calls[0], ['setFile', 'abc', 'ГОСТ 4121-96 скан.pdf', pdf.length, 'ГОСТ 4121-96.pdf']);
});

test('PUT /:id/file: не PDF по типу или расширению -> 400, без файла -> 400', async () => {
  calls.length = 0;
  await request(server()).put('/api/normativ/abc/file').set('Authorization', auth)
    .attach('file', Buffer.from('<html>'), { filename: 'a.html', contentType: 'text/html' }).expect(400);
  await request(server()).put('/api/normativ/abc/file').set('Authorization', auth)
    .attach('file', pdf, { filename: 'a.html', contentType: 'application/pdf' }).expect(400);
  await request(server()).put('/api/normativ/abc/file').set('Authorization', auth)
    .attach('file', pdf, { filename: 'a.pdf', contentType: 'image/png' }).expect(400);
  await request(server()).put('/api/normativ/abc/file').set('Authorization', auth).field('fileName', 'x.pdf').expect(400);
  assert.deepEqual(calls, []);
});

test('PUT /:id/file: больше 40 МБ -> 413', async () => {
  calls.length = 0;
  await request(server()).put('/api/normativ/abc/file').set('Authorization', auth)
    .attach('file', Buffer.alloc(40 * MB + 1, 32), { filename: 'big.pdf', contentType: 'application/pdf' }).expect(413);
  assert.deepEqual(calls, []);
});

test('PUT /:id/previews: картинки поля images и число страниц доходят до сервиса', async () => {
  calls.length = 0;
  await request(server())
    .put('/api/normativ/abc/previews').set('Authorization', auth)
    .field('pageCount', '9')
    .attach('images', png, { filename: 'gost-4121-96-1.png', contentType: 'image/png' })
    .attach('images', png, { filename: 'gost-4121-96-2.webp', contentType: 'image/webp' })
    .attach('images', png, { filename: 'gost-4121-96-3.jpg', contentType: 'image/jpeg' })
    .expect(200);
  assert.deepEqual(calls[0], ['setPreviews', 'abc', ['gost-4121-96-1.png', 'gost-4121-96-2.webp', 'gost-4121-96-3.jpg'], 9]);
});

test('PUT /:id/previews: не картинка, больше 20, без картинок, без числа страниц -> 400; картинка больше 2 МБ -> 413', async () => {
  calls.length = 0;
  const put = () => request(server()).put('/api/normativ/abc/previews').set('Authorization', auth);
  await put().field('pageCount', '9').attach('images', pdf, { filename: 'a.pdf', contentType: 'application/pdf' }).expect(400);
  await put().field('pageCount', '9').attach('images', png, { filename: 'a.html', contentType: 'image/png' }).expect(400);
  await put().field('pageCount', '9').attach('images', png, { filename: 'a.gif', contentType: 'image/gif' }).expect(400);
  const many = put().field('pageCount', '30');
  for (let i = 1; i <= 21; i++) many.attach('images', png, { filename: `${i}.png`, contentType: 'image/png' });
  await many.expect(400);
  await put().field('pageCount', '9').expect(400);
  await put().attach('images', png, { filename: 'a.png', contentType: 'image/png' }).expect(400);
  await put().field('pageCount', 'много').attach('images', png, { filename: 'a.png', contentType: 'image/png' }).expect(400);
  await put().field('pageCount', '9').attach('images', Buffer.alloc(2 * MB + 1, 1), { filename: 'big.png', contentType: 'image/png' }).expect(413);
  assert.deepEqual(calls, []);
});

test('PUT /:id/previews: пачка из 20 картинок доходит до сервиса', async () => {
  calls.length = 0;
  const twenty = request(server()).put('/api/normativ/abc/previews').set('Authorization', auth).field('pageCount', '45');
  for (let i = 1; i <= 20; i++) twenty.attach('images', png, { filename: `p-${i}.png`, contentType: 'image/png' });
  await twenty.expect(200);
  assert.equal(calls[0][0], 'setPreviews');
  assert.equal(calls[0][2].length, 20);
  assert.equal(calls[0][3], 45);
});

test('POST /:id/previews: пачка дописывается; число страниц необязательно', async () => {
  calls.length = 0;
  const post = () => request(server()).post('/api/normativ/abc/previews').set('Authorization', auth);
  await post().attach('images', png, { filename: 'p-21.png', contentType: 'image/png' }).attach('images', png, { filename: 'p-22.webp', contentType: 'image/webp' }).expect(201);
  await post().field('pageCount', '45').attach('images', png, { filename: 'p-23.jpg', contentType: 'image/jpeg' }).expect(201);
  assert.deepEqual(calls, [['appendPreviews', 'abc', ['p-21.png', 'p-22.webp'], undefined], ['appendPreviews', 'abc', ['p-23.jpg'], 45]]);
});

test('POST /:id/previews: не картинка, больше 20, без картинок, плохое число страниц -> 400; больше 2 МБ -> 413', async () => {
  calls.length = 0;
  const post = () => request(server()).post('/api/normativ/abc/previews').set('Authorization', auth);
  await post().attach('images', pdf, { filename: 'a.pdf', contentType: 'application/pdf' }).expect(400);
  const many = post();
  for (let i = 1; i <= 21; i++) many.attach('images', png, { filename: `${i}.png`, contentType: 'image/png' });
  await many.expect(400);
  await post().field('pageCount', '9').expect(400);
  await post().field('pageCount', '0').attach('images', png, { filename: 'a.png', contentType: 'image/png' }).expect(400);
  await post().attach('images', Buffer.alloc(2 * MB + 1, 1), { filename: 'big.png', contentType: 'image/png' }).expect(413);
  assert.deepEqual(calls, []);
});
