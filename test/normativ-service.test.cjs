// Справочник нормативных документов: сервис на мини-Prisma в памяти (как article-service.test.cjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
require('reflect-metadata');
const { BadRequestException, ConflictException, NotFoundException } = require('@nestjs/common');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { NormativService } = require('../dist/src/normativ/normativ.service');
const { CreateNormDocumentDto } = require('../dist/src/normativ/dto/create-norm-document.dto');
const { pdfDownloadName } = require('../dist/src/normativ/norm-pdf');

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && 'in' in cond) return cond.in.includes(row[key]);
    if (cond && typeof cond === 'object' && 'contains' in cond) return String(row[key] ?? '').toLowerCase().includes(cond.contains.toLowerCase());
    if (cond && typeof cond === 'object' && 'not' in cond) return row[key] !== cond.not;
    return row[key] === cond;
  });
}

function setup({ docs = [], products = [], services = [] } = {}) {
  const calls = { findMany: [], create: [], update: [], delete: [], saved: [], deleted: [], productQueries: [] };
  const prisma = {
    normDocument: {
      async findMany({ where } = {}) { calls.findMany.push(where); return docs.filter((d) => matches(d, where)); },
      async findUnique({ where }) { return docs.find((d) => matches(d, where)) ?? null; },
      async create({ data }) {
        calls.create.push(data);
        return { id: 'new', file: null, fileName: null, fileSize: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      },
      async update({ where, data }) {
        calls.update.push(data);
        return { ...docs.find((d) => d.id === where.id), ...data };
      },
      async delete({ where }) { calls.delete.push(where.id); return docs.find((d) => d.id === where.id); },
    },
    product: {
      async findMany({ where, take }) {
        calls.productQueries.push(where);
        const found = products.filter((p) => matches(p, where));
        return take ? found.slice(0, take) : found;
      },
    },
    service: {
      async findMany({ where }) { return services.filter((s) => where.slug.in.includes(s.slug)); },
    },
  };
  const files = {
    async saveFile(file) { calls.saved.push(file.originalname); return '/uploads/new.pdf'; },
    async deleteFile(path) { calls.deleted.push(path); },
  };
  return { service: new NormativService(prisma, files), calls, prisma };
}

const doc = (code, extra = {}) => ({
  id: extra.id ?? code, slug: code.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-'), code, name: `Название ${code}`,
  kind: 'gost', status: 'active', replacedBy: null, introducedAt: '1997-01-01', scope: 'Область', sections: ['kranovye-relsy'],
  sourceUrl: 'https://protect.gost.ru/', sourceName: 'Росстандарт', file: null, fileName: null, fileSize: null,
  title: 'T', description: 'D', h1: 'H', body: '<p>текст</p>', weight: 'main', published: true,
  publishedAt: new Date('2026-10-01'), createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-02'), ...extra,
});
let n = 0;
const product = (sku, gost, extra = {}) => ({
  id: `p${++n}`, sku, slug: sku.toLowerCase(), title: `Товар ${sku}`, gost, price: 10, stock: 5, condition: 'NEW', images: [],
  category: { slug: 'kranovye-relsy', name: 'Крановые рельсы' }, subcategory: null,
  specs: [{ id: 's', label: 'Длина', value: '12', unit: 'м' }], ...extra,
});
const validDto = {
  code: 'ГОСТ 4121-96', name: 'Рельсы крановые', kind: 'gost', status: 'active', scope: 'Крановые рельсы',
  title: 'T', description: 'D', h1: 'H', body: '<p>a</p>', weight: 'main',
};

test('публичный список: только опубликованные, без body, с hasFile, естественный порядок номеров', async () => {
  const { service, calls } = setup({ docs: [
    doc('ГОСТ 4121-96', { file: '/uploads/a.pdf' }),
    doc('ГОСТ 977-88'),
    doc('ГОСТ Р 53866-2010'),
    doc('ГОСТ 10791-2011'),
    doc('ГОСТ 1-1', { published: false }),
  ] });
  const { items } = await service.findPublished();
  assert.equal(calls.findMany[0].published, true);
  assert.deepEqual(items.map((d) => d.code), ['ГОСТ 977-88', 'ГОСТ 4121-96', 'ГОСТ 10791-2011', 'ГОСТ Р 53866-2010']);
  assert.ok(items.every((d) => !('body' in d) && !('id' in d) && !('file' in d)));
  assert.deepEqual(items.map((d) => d.hasFile), [false, true, false, false]);
  assert.deepEqual(Object.keys(items[0]).sort(), ['code', 'hasFile', 'introducedAt', 'kind', 'name', 'replacedBy', 'scope', 'sections', 'slug', 'status', 'updatedAt']);
});

test('админский список: черновики тоже, с id и published, без body', async () => {
  const { service } = setup({ docs: [doc('ГОСТ 4121-96'), doc('ГОСТ 1-1', { published: false })] });
  const { items } = await service.findAllAdmin();
  assert.deepEqual(items.map((d) => [d.id, d.published]), [['ГОСТ 1-1', false], ['ГОСТ 4121-96', true]]);
  assert.ok(items.every((d) => !('body' in d)));
});

test('документ по адресу: черновик и несуществующий -> NotFoundException; предпросмотр по id отдаёт черновик', async () => {
  const draft = doc('ГОСТ 1-1', { id: 'd1', published: false });
  const { service } = setup({ docs: [draft] });
  await assert.rejects(() => service.findOneBySlug(draft.slug), NotFoundException);
  await assert.rejects(() => service.findOneBySlug('net-takogo'), NotFoundException);
  const preview = await service.findOneById('d1');
  assert.equal(preview.code, 'ГОСТ 1-1');
  await assert.rejects(() => service.findOneById('nope'), NotFoundException);
});

test('страница документа: карточки из [[CARD]] с gost, все товары по gost без ложных и без дублей, услуги, замена', async () => {
  const inText = product('TM-0001', 'ГОСТ 4121-96');
  const byGost = product('TM-0002', 'ГОСТ 4121-96, ГОСТ Р 53866-2010');
  const oldName = product('TM-0003', 'ГОСТ 4121-76 (заменён на ГОСТ 4121-96)');
  const falseMatch = product('TM-0004', 'ГОСТ 14121-96');
  const other = product('TM-0005', 'ГОСТ 24741-2016');
  const noGost = product('TM-0006', null);
  const target = doc('ГОСТ 4121-76', {
    status: 'replaced', replacedBy: 'ГОСТ 4121–96',
    body: '<p>[[CARD TM-0001 TM-0404]]</p><p>[[SERVICE rezka]]</p>',
  });
  const { service } = setup({
    docs: [target, doc('ГОСТ 4121-96', { id: 'new96' })],
    products: [inText, byGost, oldName, falseMatch, other, noGost],
    services: [{ slug: 'rezka', title: 'Резка', description: 'd', image: null }],
  });
  const full = await service.findOneBySlug(target.slug);
  assert.deepEqual(full.products.map((p) => p.sku), ['TM-0001']);
  assert.equal(full.products[0].gost, 'ГОСТ 4121-96');
  assert.equal(full.products[0].categoryName, 'Крановые рельсы');
  assert.deepEqual({ ...full.products[0].specs[0] }, { label: 'Длина', value: '12', unit: 'м' });
  assert.deepEqual(full.relatedProducts.map((p) => p.sku), ['TM-0003']);
  assert.deepEqual(full.services.map((s) => s.slug), ['rezka']);
  assert.deepEqual({ ...full.replacedByDoc }, { slug: 'гост-4121-96', code: 'ГОСТ 4121-96' });
  assert.equal(full.body, target.body);
  assert.equal(full.hasFile, false);

  const doc96 = await service.findOneById('new96');
  assert.deepEqual(doc96.relatedProducts.map((p) => p.sku), ['TM-0001', 'TM-0002', 'TM-0003']);
  assert.equal(doc96.replacedByDoc, null);
});

test('товаров по документу — не больше 24', async () => {
  const products = Array.from({ length: 30 }, (_, i) => product(`TM-${String(100 + i).padStart(4, '0')}`, 'ГОСТ 8142-89'));
  const { service } = setup({ docs: [doc('ГОСТ 8142-89')], products });
  const full = await service.findOneBySlug('гост-8142-89');
  assert.equal(full.relatedProducts.length, 24);
});

test('замена, которой нет в справочнике или она черновик, -> replacedByDoc: null', async () => {
  const { service } = setup({ docs: [
    doc('ГОСТ 5812-82', { replacedBy: 'ГОСТ 5812-2014' }),
    doc('ГОСТ 5812-2014', { published: false }),
  ] });
  const full = await service.findOneBySlug('гост-5812-82');
  assert.equal(full.replacedByDoc, null);
});

test('create: slug по номеру, если не задан; body чистится; publishedAt при публикации', async () => {
  const { service, calls } = setup();
  const created = await service.create({ ...validDto, code: 'ГОСТ Р 53866-2010', body: '<p onclick="x">a</p><script>1</script>', published: true });
  assert.equal(calls.create[0].slug, 'gost-r-53866-2010');
  assert.equal(calls.create[0].body, '<p>a</p>');
  assert.ok(calls.create[0].publishedAt instanceof Date);
  assert.deepEqual(calls.create[0].sections, []);
  assert.equal(created.id, 'new');
  assert.ok(!('body' in created));
});

test('повтор slug или code (P2002) и тот же номер в другом написании -> ConflictException', async () => {
  const { service } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a' })] });
  await assert.rejects(() => service.create({ ...validDto, code: 'ГОСТ 4121–96', slug: 'drugoy' }), ConflictException);
  service.prisma.normDocument.create = () => { throw Object.assign(new Error('Unique'), { code: 'P2002' }); };
  await assert.rejects(() => service.create({ ...validDto, code: 'ГОСТ 1-1' }), ConflictException);
  service.prisma.normDocument.update = () => { throw Object.assign(new Error('Unique'), { code: 'P2002' }); };
  await assert.rejects(() => service.update('a', { slug: 'b' }), ConflictException);
});

test('update: свой же номер не конфликт; body чистится; null очищает замену', async () => {
  const { service, calls } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a', replacedBy: 'ГОСТ 1-1' })] });
  await service.update('a', { code: 'ГОСТ 4121-96', body: '<p onclick="x">b</p>', replacedBy: null });
  assert.equal(calls.update[0].body, '<p>b</p>');
  assert.equal(calls.update[0].replacedBy, null);
  await assert.rejects(() => service.update('nope', { name: 'x' }), NotFoundException);
});

test('DTO: тип, статус, вес — только из списков; slug admin и с заглавными — нет; лишнее поле file — нет в DTO', async () => {
  const check = async (extra) => (await validate(plainToInstance(CreateNormDocumentDto, { ...validDto, ...extra }))).map((e) => e.property);
  assert.deepEqual(await check({}), []);
  assert.deepEqual(await check({ kind: 'din' }), ['kind']);
  assert.deepEqual(await check({ status: 'old' }), ['status']);
  assert.deepEqual(await check({ weight: 'big' }), ['weight']);
  assert.deepEqual(await check({ slug: 'admin' }), ['slug']);
  assert.deepEqual(await check({ slug: 'Gost 4121' }), ['slug']);
  assert.deepEqual(await check({ introducedAt: '1997-13-01' }), ['introducedAt']);
  assert.deepEqual(await check({ sections: ['Kranovye relsy'] }), ['sections']);
  assert.deepEqual(await check({ sourceUrl: 'javascript:alert(1)' }), ['sourceUrl']);
  assert.deepEqual(await check({ slug: 'gost-4121-96', introducedAt: '1997-01-01', sections: ['kranovye-relsy'], sourceUrl: 'https://protect.gost.ru/x' }), []);
  assert.ok(!('file' in new CreateNormDocumentDto()));
});

test('setFile: сохраняет PDF, пишет file/fileName/fileSize, удаляет прежний', async () => {
  const { service, calls } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a', file: '/uploads/old.pdf' })] });
  const file = { originalname: 'scan.pdf', mimetype: 'application/pdf', size: 9, buffer: Buffer.from('%PDF-1.7\n') };
  const result = await service.setFile('a', file, 'ГОСТ 4121-96.pdf');
  assert.deepEqual(calls.update[0], { file: '/uploads/new.pdf', fileName: 'ГОСТ 4121-96.pdf', fileSize: 9 });
  assert.deepEqual(calls.deleted, ['/uploads/old.pdf']);
  assert.equal(result.hasFile, true);
  await service.setFile('a', file);
  assert.equal(calls.update[1].fileName, 'scan.pdf');
});

test('setFile: не PDF по содержимому -> 400, файл не сохраняется; нет документа -> 404', async () => {
  const { service, calls } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a' })] });
  const fake = { originalname: 'x.pdf', mimetype: 'application/pdf', size: 6, buffer: Buffer.from('<html>') };
  await assert.rejects(() => service.setFile('a', fake), BadRequestException);
  assert.deepEqual(calls.saved, []);
  const pdf = { ...fake, buffer: Buffer.from('%PDF-1.4') };
  await assert.rejects(() => service.setFile('nope', pdf), NotFoundException);
});

test('pdfDownloadName: без папок и служебных знаков, всегда .pdf, пустое — по номеру', () => {
  assert.equal(pdfDownloadName('ГОСТ 4121-96.pdf', 'x'), 'ГОСТ 4121-96.pdf');
  assert.equal(pdfDownloadName('C:\\docs\\ТУ 14-2Р-383-2004.PDF', 'x'), 'ТУ 14-2Р-383-2004.pdf');
  assert.equal(pdfDownloadName('a"b<c>\n.pdf', 'x'), 'a b c.pdf');
  assert.equal(pdfDownloadName('Распоряжение', 'x'), 'Распоряжение.pdf');
  assert.equal(pdfDownloadName('', 'ГОСТ Р 53866-2010'), 'ГОСТ Р 53866-2010.pdf');
  assert.equal(pdfDownloadName(undefined, 'СП 1/2'), 'СП 1 2.pdf');
  assert.ok(pdfDownloadName('я'.repeat(500), 'x').length <= 150);
});

test('delete удаляет запись и файл; нет документа -> 404', async () => {
  const { service, calls } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a', file: '/uploads/a.pdf' })] });
  await service.delete('a');
  assert.deepEqual(calls.delete, ['a']);
  assert.deepEqual(calls.deleted, ['/uploads/a.pdf']);
  await assert.rejects(() => service.delete('nope'), NotFoundException);
});
