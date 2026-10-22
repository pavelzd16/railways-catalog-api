// Загрузка картинок статьи (обложка и картинки в тексте): только JPG, PNG, WEBP, GIF, остальное — 400.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const request = require('supertest');
const { Controller, Module, Post, UploadedFile, UseInterceptors } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { FileInterceptor } = require('@nestjs/platform-express');
const { memoryStorage } = require('multer');
const { articleImageFilter } = require('../dist/src/article/article-image-filter');
const { MulterExceptionFilter } = require('../dist/src/common/multer-exception.filter');

const MESSAGE = 'Можно загрузить только картинку (JPG, PNG, WEBP, GIF)';
const decide = (mimetype) => {
  let result;
  articleImageFilter({}, { mimetype }, (error, accept) => { result = { error, accept }; });
  return result;
};

test('articleImageFilter пропускает jpeg, png, webp, gif', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
    assert.deepEqual(decide(type), { error: null, accept: true }, type);
  }
});
test('articleImageFilter отклоняет остальное ошибкой 400', () => {
  for (const type of ['image/svg+xml', 'text/html', 'application/pdf', 'application/octet-stream', '']) {
    const { error, accept } = decide(type);
    assert.equal(accept, false, type);
    assert.equal(error.getStatus(), 400, type);
    assert.equal(error.message, MESSAGE, type);
  }
});

// Тот же перехватчик, что в ArticleController, через настоящий multer.
class UploadController {
  upload(file) { return { name: file.originalname }; }
}
Reflect.decorate(
  [Post('upload'), UseInterceptors(FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: articleImageFilter }))],
  UploadController.prototype, 'upload', Object.getOwnPropertyDescriptor(UploadController.prototype, 'upload'),
);
UploadedFile()(UploadController.prototype, 'upload', 0);
Controller('article')(UploadController);
class UploadModule {}
Module({ controllers: [UploadController] })(UploadModule);

let app;
before(async () => {
  app = await NestFactory.create(UploadModule, { logger: false });
  app.useGlobalFilters(new MulterExceptionFilter());
  await app.init();
});
after(() => app?.close());

test('загрузка png проходит, html и svg — 400 с понятным текстом', async () => {
  await request(app.getHttpServer())
    .post('/article/upload')
    .attach('image', Buffer.from('png'), { filename: 'a.png', contentType: 'image/png' })
    .expect(201, { name: 'a.png' });
  for (const [filename, contentType] of [['a.html', 'text/html'], ['a.svg', 'image/svg+xml']]) {
    const response = await request(app.getHttpServer())
      .post('/article/upload')
      .attach('image', Buffer.from('<svg onload=alert(1)>'), { filename, contentType })
      .expect(400);
    assert.equal(response.body.message, MESSAGE, filename);
  }
});
