// Загрузка файлов через Nest + multer с теми же настройками, что в контроллерах товаров, категорий,
// услуг и заявок: память, лимит размера, ограничение числа файлов. Нужен, чтобы обновление multer
// (уязвимости GHSA-wc9g-mqfw-jrwm и др.) не поменяло поведение загрузки.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const request = require('supertest');
const { Controller, Module, Post, UploadedFiles, UseInterceptors } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { FileFieldsInterceptor, FilesInterceptor } = require('@nestjs/platform-express');
const { memoryStorage, MulterError } = require('multer');
const { MulterExceptionFilter, multerErrorToHttpException } = require('../dist/src/common/multer-exception.filter');

const MB = 1024 * 1024;

class UploadController {
  images(files) {
    return files.map((file) => ({ name: file.originalname, size: file.size, buffer: file.buffer.length }));
  }
  attachments(files) {
    return Object.fromEntries(Object.entries(files).map(([field, list]) => [field, list.map((file) => file.originalname)]));
  }
}
const describeMethod = (name) => Object.getOwnPropertyDescriptor(UploadController.prototype, name);
Reflect.decorate(
  [Post('images'), UseInterceptors(FilesInterceptor('images', 10, { storage: memoryStorage(), limits: { fileSize: 5 * MB } }))],
  UploadController.prototype, 'images', describeMethod('images'),
);
UploadedFiles()(UploadController.prototype, 'images', 0);
Reflect.decorate(
  [Post('attachments'), UseInterceptors(FileFieldsInterceptor([{ name: 'requestFile', maxCount: 1 }, { name: 'partnerMapFile', maxCount: 1 }], { storage: memoryStorage(), defParamCharset: 'utf8', limits: { fileSize: 10 * MB } }))],
  UploadController.prototype, 'attachments', describeMethod('attachments'),
);
UploadedFiles()(UploadController.prototype, 'attachments', 0);
Controller('upload')(UploadController);

class UploadModule {}
Module({ controllers: [UploadController] })(UploadModule);

let app;
before(async () => {
  app = await NestFactory.create(UploadModule, { logger: false });
  // Как в src/main.ts.
  app.useGlobalFilters(new MulterExceptionFilter());
  await app.init();
});
after(() => app?.close());

test('several images are received in memory with their size', async () => {
  const response = await request(app.getHttpServer())
    .post('/upload/images')
    .field('title', 'Накладка')
    .attach('images', Buffer.alloc(1024, 1), 'a.png')
    .attach('images', Buffer.alloc(2048, 2), 'b.png')
    .expect(201);
  assert.deepEqual(response.body, [
    { name: 'a.png', size: 1024, buffer: 1024 },
    { name: 'b.png', size: 2048, buffer: 2048 },
  ]);
});

test('a file above the size limit is rejected with 413', async () => {
  await request(app.getHttpServer())
    .post('/upload/images')
    .attach('images', Buffer.alloc(5 * MB + 1), 'big.png')
    .expect(413);
});

test('more files than maxCount in a field is rejected with 400, not 500', async () => {
  const response = await request(app.getHttpServer())
    .post('/upload/attachments')
    .attach('requestFile', Buffer.from('1'), 'one.pdf')
    .attach('requestFile', Buffer.from('2'), 'two.pdf')
    .expect(400);
  assert.match(response.body.message, /requestFile/);
});

test('every multer error code becomes a client error: 413 for size, 400 for the rest', () => {
  const codes = ['LIMIT_PART_COUNT', 'LIMIT_FILE_COUNT', 'LIMIT_FIELD_KEY', 'LIMIT_FIELD_VALUE', 'LIMIT_FIELD_COUNT', 'LIMIT_UNEXPECTED_FILE', 'MISSING_FIELD_NAME', 'LIMIT_FIELD_NESTING', 'LIMIT_FIELD_ARRAY_INDEX', 'INVALID_FIELD_NAME', 'STREAM_DESTROYED'];
  for (const code of codes) assert.equal(multerErrorToHttpException(new MulterError(code, 'images')).getStatus(), 400, code);
  assert.equal(multerErrorToHttpException(new MulterError('LIMIT_FILE_SIZE', 'images')).getStatus(), 413);
});

test('named file fields arrive separately', async () => {
  const response = await request(app.getHttpServer())
    .post('/upload/attachments')
    .attach('requestFile', Buffer.from('1'), 'zayavka.pdf')
    .attach('partnerMapFile', Buffer.from('2'), 'karta.pdf')
    .expect(201);
  assert.deepEqual(response.body, { requestFile: ['zayavka.pdf'], partnerMapFile: ['karta.pdf'] });
});

// Имя файла клиента уходит вложением в письмо о заявке — оно должно остаться читаемым.
test('a Cyrillic file name of a request attachment survives the upload', async () => {
  const response = await request(app.getHttpServer())
    .post('/upload/attachments')
    .attach('requestFile', Buffer.from('1'), 'Смета на рельсы.pdf')
    .expect(201);
  assert.deepEqual(response.body, { requestFile: ['Смета на рельсы.pdf'] });
});
