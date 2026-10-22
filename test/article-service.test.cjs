const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
require('reflect-metadata');
const { ConflictException, NotFoundException } = require('@nestjs/common');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { ArticleService, readingMinutes } = require('../dist/src/article/article.service');
const { CreateArticleDto } = require('../dist/src/article/dto/create-article.dto');

// Мини-Prisma: статьи и товары лежат в памяти; поддержаны только условия, которые строит сервис.
function matchesArticle(article, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && 'not' in cond) return article[key] !== cond.not;
    if (cond && typeof cond === 'object' && 'notIn' in cond) return !cond.notIn.includes(article[key]);
    return article[key] === cond;
  });
}

function setup({ articles = [], products = [], services = [] } = {}) {
  const calls = { findMany: [], create: [], update: [] };
  const prisma = {
    article: {
      async findMany({ where, take }) {
        calls.findMany.push(where);
        // Порядок как у сервиса: свежие сверху (в тестовых данных уже так и лежат).
        const found = articles.filter((a) => matchesArticle(a, where));
        return take ? found.slice(0, take) : found;
      },
      async count({ where }) { return articles.filter((a) => matchesArticle(a, where)).length; },
      async findUnique({ where }) {
        return articles.find((a) => Object.entries(where).every(([k, v]) => a[k] === v)) ?? null;
      },
      async create({ data }) { calls.create.push(data); return { id: 'new', image: null, createdAt: new Date(), updatedAt: new Date(), ...data }; },
      async update({ where, data }) {
        calls.update.push(data);
        const existing = articles.find((a) => a.id === where.id);
        return { ...existing, ...data };
      },
    },
    product: {
      async findMany({ where }) { return products.filter((p) => where.sku.in.includes(p.sku)); },
    },
    service: {
      async findMany({ where }) { return services.filter((s) => where.slug.in.includes(s.slug)); },
    },
  };
  return { service: new ArticleService(prisma, { async saveFile() { return '/uploads/x.png'; }, async deleteFile() {} }), calls };
}

const art = (id, category, body = '<p>текст</p>', extra = {}) => ({
  id, slug: id, title: id, description: 'd', h1: id, category, image: null, body,
  published: true, publishedAt: new Date('2026-10-01'), createdAt: new Date(), updatedAt: new Date(), ...extra,
});
const product = { id: 'p1', sku: 'TM-0001', slug: 'p1', title: 'Рельс', price: 10, stock: 5, condition: 'NEW', images: [],
  category: { slug: 'relsy', name: 'Рельсы' }, subcategory: null, specs: [{ id: 's', label: 'Длина', value: '12', unit: 'м' }] };

test('список берёт только опубликованные статьи', async () => {
  const { service, calls } = setup({ articles: [art('a', 'Рельсы')] });
  await service.findPublished({ page: 1, limit: 12, skip: 0, take: 12 });
  assert.equal(calls.findMany[0].published, true);
});

test('черновик по адресу -> NotFoundException', async () => {
  const { service } = setup({ articles: [art('draft', 'Рельсы', '<p>x</p>', { published: false })] });
  await assert.rejects(() => service.findOneBySlug('draft'), NotFoundException);
});

test('пропавший из каталога артикул в карточках не выводится, статья открывается', async () => {
  const { service } = setup({ articles: [art('a', 'Рельсы', '<p>[[CARD TM-0001 TM-0404]]</p>')], products: [product] });
  const full = await service.findOneBySlug('a');
  assert.deepEqual(full.products.map((p) => p.sku), ['TM-0001']);
  assert.equal(full.products[0].categoryName, 'Рельсы');
  assert.equal(full.products[0].condition, 'new');
  assert.equal(typeof full.products[0].specs[0].value, 'string');
  assert.deepEqual({ ...full.products[0].specs[0] }, { label: 'Длина', value: '12', unit: 'м' });
});

test('related: без самой статьи, не больше 3, сначала та же рубрика', async () => {
  const articles = [
    art('self', 'Рельсы'), art('x1', 'Шпалы'), art('r1', 'Рельсы'), art('x2', 'Шпалы'), art('r2', 'Рельсы'), art('x3', 'Закупка'),
  ];
  const { service } = setup({ articles });
  const full = await service.findOneBySlug('self');
  assert.ok(full.related.length <= 3);
  assert.deepEqual(full.related.map((a) => a.id), ['r1', 'r2', 'x1']);
  assert.ok(!full.related.some((a) => a.id === 'self'));
});

test('slug с заглавными буквами и пробелом отклоняется, зарезервированные admin/upload тоже', async () => {
  const valid = { title: 't', description: 'd', h1: 'h', category: 'Рельсы', body: '<p>a</p>' };
  const bad = await validate(plainToInstance(CreateArticleDto, { ...valid, slug: 'Bad Slug' }));
  assert.ok(bad.some((e) => e.property === 'slug'));
  for (const slug of ['admin', 'upload']) {
    const errors = await validate(plainToInstance(CreateArticleDto, { ...valid, slug }));
    assert.ok(errors.some((e) => e.property === 'slug'), slug);
  }
  assert.deepEqual(await validate(plainToInstance(CreateArticleDto, { ...valid, slug: 'relsy-r65' })), []);
});

test('create чистит html и ставит publishedAt при публикации', async () => {
  const { service, calls } = setup();
  await service.create({ slug: 's', title: 't', description: 'd', h1: 'h', category: 'Рельсы', body: '<p onclick="x">a</p>', published: true });
  assert.equal(calls.create[0].body, '<p>a</p>');
  assert.ok(calls.create[0].publishedAt instanceof Date);
});

test('update: публикация черновика без даты ставит publishedAt', async () => {
  const { service, calls } = setup({ articles: [art('a', 'Рельсы', '<p>x</p>', { published: false, publishedAt: null })] });
  await service.update('a', { published: true });
  assert.ok(calls.update[0].publishedAt instanceof Date);
});

test('readingMinutes: 900 слов = 5, пустой текст = 1, теги не считаются', () => {
  const words = Array(900).fill('слово').join(' ');
  assert.equal(readingMinutes(`<p>${words}</p>`), 5);
  assert.equal(readingMinutes('<p></p>'), 1);
  const { service } = setup({ articles: [art('a', 'Рельсы', `<p class="a b">${words}</p>`)] });
  return service.findOneBySlug('a').then((full) => assert.equal(full.readingMinutes, 5));
});

test('повторный slug (P2002) при create и update -> ConflictException (409)', async () => {
  const { service } = setup({ articles: [art('a', 'Рельсы')] });
  const duplicate = () => { throw Object.assign(new Error('Unique constraint'), { code: 'P2002' }); };
  service.prisma.article.create = duplicate;
  service.prisma.article.update = duplicate;
  await assert.rejects(
    () => service.create({ slug: 'a', title: 't', description: 'd', h1: 'h', category: 'Рельсы', body: '<p>a</p>' }),
    (e) => e instanceof ConflictException && e.message === 'Статья с таким адресом уже есть',
  );
  await assert.rejects(() => service.update('a', { slug: 'b' }), ConflictException);
});

test('админский список отдаёт published:false для черновика, публичный — true', async () => {
  const { service } = setup({ articles: [art('d', 'Рельсы', '<p>x</p>', { published: false }), art('p', 'Рельсы')] });
  const admin = await service.findAllAdmin({ page: 1, limit: 12, skip: 0, take: 12 });
  assert.deepEqual(admin.items.map((a) => [a.id, a.published]), [['d', false], ['p', true]]);
  const pub = await service.findPublished({ page: 1, limit: 12, skip: 0, take: 12 });
  assert.deepEqual(pub.items.map((a) => a.published), [true]);
});
