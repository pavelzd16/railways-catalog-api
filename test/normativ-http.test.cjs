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
