const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
const { ValidationPipe } = require('@nestjs/common');
const { ProductService } = require('../dist/src/product/product.service');
const { CreateProductDto } = require('../dist/src/product/dto/create-product.dto');
const { UpdateProductDto } = require('../dist/src/product/dto/update-product.dto');

function setup(extra = {}) {
  const state = {
    id: 'p', sku: 'SKU', slug: 'bolt', title: 'Болт', price: null,
    condition: 'NEW', stock: 1, categoryId: 'cat',
    category: { id: 'cat', slug: 'rails', name: 'Рельсы' },
    images: ['/uploads/bolt.png'], specs: [], analogues: [],
    description: 'Описание', descriptionTags: null, video: null,
    updatedAt: new Date('2026-10-29T00:00:00Z'),
    ...extra,
  };
  const prisma = {
    category: { async findUnique() { return state.category; } },
    product: {
      async findUnique() { return structuredClone(state); },
      async create({ data }) {
        Object.assign(state, data, { specs: data.specs.create });
        return structuredClone(state);
      },
      async update({ data }) {
        Object.assign(state, data);
        return structuredClone(state);
      },
    },
  };
  const files = { async deleteFiles() {} };
  return { service: new ProductService(prisma, files), state };
}

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
const asUpdate = (body) => pipe.transform(body, { type: 'body', metatype: UpdateProductDto });

test('video accepts only an mp4/webm path inside /uploads; empty clears it', async () => {
  assert.equal((await asUpdate({ video: '/uploads/a1-b2.mp4' })).video, '/uploads/a1-b2.mp4');
  assert.equal((await asUpdate({ video: '/uploads/clip.webm' })).video, '/uploads/clip.webm');
  for (const value of ['', null, 'null']) assert.equal((await asUpdate({ video: value })).video, null);
  for (const bad of ['/uploads/a.jpg', 'https://example.com/a.mp4', '/uploads/../a.mp4', '/uploads/w/480/a.mp4', ['x']]) {
    await assert.rejects(asUpdate({ video: bad }), (error) => error.getStatus() === 400, String(bad));
  }
  const base = { sku: 'SKU', title: 'Болт', slug: 'bolt', stock: '1', condition: 'new', categorySlug: 'rails' };
  assert.equal((await pipe.transform({ ...base, video: '/uploads/v.mp4' }, { type: 'body', metatype: CreateProductDto })).video, '/uploads/v.mp4');
});

test('update sets and clears the video without touching images; other edits keep it', async () => {
  const { service, state } = setup();
  assert.equal((await service.update('p', { video: '/uploads/v.mp4' })).video, '/uploads/v.mp4');
  assert.equal((await service.update('p', { title: 'Другой' })).video, '/uploads/v.mp4');
  assert.deepEqual(state.images, ['/uploads/bolt.png']);
  assert.equal((await service.update('p', { video: null })).video, null);
});

test('create stores the video or leaves it empty', async () => {
  const base = { sku: 'SKU', title: 'Болт', slug: 'bolt', stock: 1, condition: 'new', categorySlug: 'rails' };
  assert.equal((await setup().service.create({ ...base, video: '/uploads/v.mp4' })).video, '/uploads/v.mp4');
  assert.equal((await setup().service.create(base)).video, null);
});
