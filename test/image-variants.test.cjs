// Уменьшенные WebP-копии картинок: /uploads/w/<ширина>/<файл>.webp (src/file/image-variants.ts).
// Копия делается по первому запросу и кладётся рядом, оригинал не меняется.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile, stat, readdir, unlink, utimes } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const {
  parseVariantPath,
  createVariantHandler,
  variantFilePath,
  variantPathsFor,
  VARIANT_WIDTHS,
} = require('../dist/src/file/image-variants');

let dir;
let app;
const photo = 'a1b2c3d4-0000-4000-8000-000000000001.jpg';

// Бинарный ответ supertest отдаёт буфером только с явным парсером.
const binary = (res, done) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uploads-'));
  const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#8a6d3b' } })
    .jpeg({ quality: 90 })
    .toBuffer();
  await writeFile(join(dir, photo), jpeg);
  await writeFile(join(dir, 'broken.jpg'), Buffer.from('это не картинка'));
  app = express();
  app.use('/uploads/w', createVariantHandler(dir));
  app.use('/uploads', express.static(dir));
});
after(() => rm(dir, { recursive: true, force: true }));

test('only listed widths and plain file names are accepted', () => {
  assert.deepEqual(parseVariantPath(`/480/${photo}.webp`), { width: 480, source: photo });
  assert.deepEqual(parseVariantPath('/160/x.PNG.webp'), { width: 160, source: 'x.PNG' });
  assert.equal(parseVariantPath(`/481/${photo}.webp`), null);
  assert.equal(parseVariantPath(`/4800/${photo}.webp`), null);
  assert.equal(parseVariantPath(`/480/${photo}`), null);
  assert.equal(parseVariantPath('/480/..%2Fsecret.jpg.webp'), null);
  assert.equal(parseVariantPath('/480/sub/x.jpg.webp'), null);
  assert.equal(parseVariantPath('/480/request.pdf.webp'), null);
  assert.equal(parseVariantPath('/480/.hidden.jpg.webp'), null);
});

test('first request renders a WebP of the asked width and saves it next to uploads', async () => {
  const res = await request(app).get(`/uploads/w/480/${photo}.webp`).buffer(true).parse(binary).expect(200);
  assert.equal(res.headers['content-type'], 'image/webp');
  assert.match(res.headers['cache-control'], /max-age=2592000/);
  const meta = await sharp(res.body).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 480);
  assert.equal(meta.height, 320);
  const saved = await stat(variantFilePath(dir, 480, photo));
  assert.equal(saved.size, res.body.length);
});

test('second request serves the saved copy without rendering again', async () => {
  const path = variantFilePath(dir, 320, photo);
  await request(app).get(`/uploads/w/320/${photo}.webp`).expect(200);
  const first = await stat(path);
  const res = await request(app).get(`/uploads/w/320/${photo}.webp`).buffer(true).parse(binary).expect(200);
  const second = await stat(path);
  assert.equal(second.mtimeMs, first.mtimeMs);
  assert.equal(res.headers['content-type'], 'image/webp');
  assert.match(res.headers['cache-control'], /max-age=2592000/);
});

test('a copy older than its original is rendered again', async () => {
  const path = variantFilePath(dir, 640, photo);
  await request(app).get(`/uploads/w/640/${photo}.webp`).expect(200);
  const old = new Date(Date.now() - 60_000);
  await utimes(path, old, old);
  await request(app).get(`/uploads/w/640/${photo}.webp`).expect(200);
  assert.ok((await stat(path)).mtimeMs > old.getTime());
});

test('small originals are not enlarged', async () => {
  const res = await request(app).get(`/uploads/w/1280/${photo}.webp`).buffer(true).parse(binary).expect(200);
  assert.equal((await sharp(res.body).metadata()).width, 1200);
});

test('unknown width, missing original and bad names answer 404', async () => {
  await request(app).get(`/uploads/w/500/${photo}.webp`).expect(404);
  await request(app).get('/uploads/w/480/net-takogo.jpg.webp').expect(404);
  await request(app).get('/uploads/w/480/%2E%2E%2Fsecret.jpg.webp').expect(404);
});

test('a file that is not an image falls back to the original', async () => {
  const res = await request(app).get('/uploads/w/480/broken.jpg.webp').expect(302);
  assert.equal(res.headers.location, '/uploads/broken.jpg');
});

test('when the original is removed its saved copy is not served any more', async () => {
  const name = 'a1b2c3d4-0000-4000-8000-000000000002.jpg';
  await writeFile(join(dir, name), await sharp({ create: { width: 400, height: 400, channels: 3, background: '#000' } }).jpeg().toBuffer());
  await request(app).get(`/uploads/w/160/${name}.webp`).expect(200);
  await unlink(join(dir, name));
  await request(app).get(`/uploads/w/160/${name}.webp`).expect(404);
  const left = await readdir(join(dir, 'w', '160'));
  assert.ok(!left.includes(`${name}.webp`));
});

test('parallel requests for the same copy render it once and all get the picture', async () => {
  const name = 'a1b2c3d4-0000-4000-8000-000000000003.jpg';
  await writeFile(join(dir, name), await sharp({ create: { width: 900, height: 900, channels: 3, background: '#fff' } }).jpeg().toBuffer());
  const results = await Promise.all(
    Array.from({ length: 5 }, () => request(app).get(`/uploads/w/960/${name}.webp`).buffer(true).parse(binary)),
  );
  for (const res of results) {
    assert.equal(res.status, 200);
    assert.equal((await sharp(res.body).metadata()).width, 900);
  }
  const files = await readdir(join(dir, 'w', '960'));
  assert.deepEqual(files.filter((f) => f.startsWith(name)), [`${name}.webp`]);
});

test('every listed width has its own copy path for deletion', () => {
  const paths = variantPathsFor(dir, photo);
  assert.equal(paths.length, VARIANT_WIDTHS.length);
  assert.ok(paths.every((p) => p.endsWith(`${photo}.webp`)));
});
