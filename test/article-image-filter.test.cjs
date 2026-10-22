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
const decide = (mimetype, originalname = 'a.png') => {
  let result;
  articleImageFilter({}, { mimetype, originalname }, (error, accept) => { result = { error, accept }; });
  return result;
};
const assertRejected = ({ error, accept }, label) => {
  assert.equal(accept, false, label);
  assert.equal(error.getStatus(), 400, label);
  assert.equal(error.message, MESSAGE, label);
};

test('articleImageFilter пропускает jpeg, png, webp, gif с картиночным расширением', () => {
  for (const [type, name] of [['image/jpeg', 'a.jpg'], ['image/jpeg', 'Фото.JPEG'], ['image/png', 'a.png'], ['image/webp', 'a.webp'], ['image/gif', 'a.GIF']]) {
    assert.deepEqual(decide(type, name), { error: null, accept: true }, `${type} ${name}`);
  }
});
test('articleImageFilter отклоняет остальное ошибкой 400', () => {
  for (const type of ['image/svg+xml', 'text/html', 'application/pdf', 'application/octet-stream', '']) {
    assertRejected(decide(type), type);
  }
});
test('articleImageFilter: картиночный тип с чужим расширением — тоже 400', () => {
  for (const name of ['x.html', 'x.svg', 'x.png.html', 'x.php', 'x', 'png', 'x.png ', '']) {
    assertRejected(decide('image/png', name), name);
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

test('загрузка png проходит; html, svg и html под видом png — 400 с понятным текстом', async () => {
  await request(app.getHttpServer())
    .post('/article/upload')
    .attach('image', Buffer.from('png'), { filename: 'a.png', contentType: 'image/png' })
    .expect(201, { name: 'a.png' });
  for (const [filename, contentType] of [['a.html', 'text/html'], ['a.svg', 'image/svg+xml'], ['x.html', 'image/png']]) {
    const response = await request(app.getHttpServer())
      .post('/article/upload')
      .attach('image', Buffer.from('<svg onload=alert(1)>'), { filename, contentType })
      .expect(400);
    assert.equal(response.body.message, MESSAGE, filename);
  }
});
