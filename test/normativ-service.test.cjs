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
        return { id: 'new', file: null, fileName: null, fileSize: null, pageCount: null, previews: [], createdAt: new Date(), updatedAt: new Date(), ...data };
      },
      async update({ where, data }) {
        calls.update.push(data);
        return { ...docs.find((d) => d.id === where.id), ...data };
      },
      async delete({ where }) { calls.delete.push(where.id); return docs.find((d) => d.id === where.id); },
    },
    async $transaction(fn) { return fn(prisma); },
    async $executeRaw() { return 0; },
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
    async saveFile(file) {
      calls.saved.push(file.originalname);
      return /\.pdf$/i.test(file.originalname) ? '/uploads/new.pdf' : `/uploads/img-${calls.saved.length}.${file.originalname.split('.').pop()}`;
    },
    async deleteFile(path) { calls.deleted.push(path); },
  };
  return { service: new NormativService(prisma, files), calls, prisma };
}

const doc = (code, extra = {}) => ({
  id: extra.id ?? code, slug: code.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-'), code, name: `Название ${code}`,
  kind: 'gost', status: 'active', replacedBy: null, introducedAt: '1997-01-01', scope: 'Область', sections: ['kranovye-relsy'],
  sourceUrl: 'https://protect.gost.ru/', sourceName: 'Росстандарт', file: null, fileName: null, fileSize: null, pageCount: null, previews: [],
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
    doc('ГОСТ 4121-96', { file: '/uploads/a.pdf', pageCount: 9, previews: ['/uploads/p1.webp'] }),
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
  assert.deepEqual(items.map((d) => d.pageCount), [null, 9, null, null]);
  assert.deepEqual(Object.keys(items[0]).sort(), ['code', 'hasFile', 'introducedAt', 'kind', 'name', 'pageCount', 'replacedBy', 'scope', 'sections', 'slug', 'status', 'updatedAt']);
  assert.ok(items.every((d) => !('previews' in d)), 'картинки страниц — только на странице документа');
});

test('админский список: черновики тоже, с id и published, без body', async () => {
  const { service } = setup({ docs: [doc('ГОСТ 4121-96'), doc('ГОСТ 1-1', { published: false })] });
  const { items } = await service.findAllAdmin();
  assert.deepEqual(items.map((d) => [d.id, d.published]), [['ГОСТ 1-1', false], ['ГОСТ 4121-96', true]]);
  assert.deepEqual(items.map((d) => [d.pageCount, [...d.previews]]), [[null, []], [null, []]]);
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
  assert.equal(full.pageCount, null);
  assert.deepEqual([...full.previews], []);

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

test('delete удаляет запись, файл и картинки страниц; нет документа -> 404', async () => {
  const { service, calls } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a', file: '/uploads/a.pdf', previews: ['/uploads/p1.webp', '/uploads/p2.webp'] })] });
  await service.delete('a');
  assert.deepEqual(calls.delete, ['a']);
  assert.deepEqual(calls.deleted.sort(), ['/uploads/a.pdf', '/uploads/p1.webp', '/uploads/p2.webp']);
  await assert.rejects(() => service.delete('nope'), NotFoundException);
});

// Картинки страниц: настоящие сигнатуры форматов — сервер смотрит и на содержимое, не только на имя.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const image = (name, buffer, mimetype) => ({ originalname: name, mimetype, size: buffer.length, buffer });

test('setPreviews: картинки по порядку, previews и pageCount в записи, прежние картинки удаляются', async () => {
  const { service, calls } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a', file: '/uploads/a.pdf', previews: ['/uploads/old1.webp', '/uploads/old2.webp'] })] });
  const result = await service.setPreviews('a', [
    image('gost-4121-96-1.webp', WEBP, 'image/webp'),
    image('gost-4121-96-2.png', PNG, 'image/png'),
    image('gost-4121-96-3.jpg', JPEG, 'image/jpeg'),
  ], 9);
  assert.deepEqual(calls.saved, ['gost-4121-96-1.webp', 'gost-4121-96-2.png', 'gost-4121-96-3.jpg']);
  assert.deepEqual(calls.update[0], { previews: ['/uploads/img-1.webp', '/uploads/img-2.png', '/uploads/img-3.jpg'], pageCount: 9 });
  assert.deepEqual(calls.deleted.sort(), ['/uploads/old1.webp', '/uploads/old2.webp']);
  assert.equal(result.pageCount, 9);
  assert.deepEqual([...result.previews], ['/uploads/img-1.webp', '/uploads/img-2.png', '/uploads/img-3.jpg']);
  assert.equal(result.file, '/uploads/a.pdf', 'PDF не трогается');
});

test('setPreviews: не картинка по содержимому, ноль или больше 20 картинок в пачке, плохое число страниц -> 400; нет документа -> 404', async () => {
  const { service, calls } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a', previews: ['/uploads/old.webp'] })] });
  const fakeImage = image('x.png', Buffer.from('<html>'), 'image/png');
  await assert.rejects(() => service.setPreviews('a', [image('1.png', PNG, 'image/png'), fakeImage], 9), BadRequestException);
  await assert.rejects(() => service.setPreviews('a', [], 9), BadRequestException);
  const many = Array.from({ length: 21 }, (_, i) => image(`${i + 1}.png`, PNG, 'image/png'));
  await assert.rejects(() => service.setPreviews('a', many, 30), BadRequestException);
  await assert.rejects(() => service.setPreviews('a', [image('1.png', PNG, 'image/png')], 0), BadRequestException);
  assert.deepEqual(calls.saved, [], 'при ошибке ничего не сохраняется');
  assert.deepEqual(calls.deleted, [], 'и прежние картинки на месте');
  await assert.rejects(() => service.setPreviews('nope', [image('1.png', PNG, 'image/png')], 9), NotFoundException);
});

test('setPreviews: запись в базу не удалась — новые файлы удаляются, прежние остаются', async () => {
  const { service, calls, prisma } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a', previews: ['/uploads/old.webp'] })] });
  prisma.normDocument.update = async () => { throw new Error('база недоступна'); };
  await assert.rejects(() => service.setPreviews('a', [image('1.png', PNG, 'image/png')], 9), /база недоступна/);
  assert.deepEqual(calls.deleted, ['/uploads/img-1.png']);
});

test('setPreviews: пачка из 20 картинок — все страницы по порядку', async () => {
  const { service, calls } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a', previews: [] })] });
  const twenty = Array.from({ length: 20 }, (_, i) => image(`p-${i + 1}.webp`, WEBP, 'image/webp'));
  const result = await service.setPreviews('a', twenty, 45);
  assert.equal(result.previews.length, 20);
  assert.equal(calls.update[0].previews[19], '/uploads/img-20.webp');
  assert.equal(calls.update[0].pageCount, 45);
});

test('appendPreviews: пачка дописывается в конец, прежние картинки остаются, число страниц — если передано', async () => {
  const { service, calls } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a', pageCount: 45, previews: ['/uploads/p1.webp', '/uploads/p2.webp'] })] });
  const result = await service.appendPreviews('a', [image('p-3.webp', WEBP, 'image/webp'), image('p-4.png', PNG, 'image/png')]);
  assert.deepEqual(calls.update[0], { previews: ['/uploads/p1.webp', '/uploads/p2.webp', '/uploads/img-1.webp', '/uploads/img-2.png'] });
  assert.deepEqual([...result.previews], ['/uploads/p1.webp', '/uploads/p2.webp', '/uploads/img-1.webp', '/uploads/img-2.png']);
  assert.equal(result.pageCount, 45, 'число страниц не передано — прежнее');
  assert.deepEqual(calls.deleted, [], 'ничего не удаляется');
  await service.appendPreviews('a', [image('p-5.webp', WEBP, 'image/webp')], 46);
  assert.equal(calls.update[1].pageCount, 46);
});

test('appendPreviews: больше 100 картинок у документа, больше 20 в пачке, не картинка -> 400; нет документа -> 404', async () => {
  const ninetyNine = Array.from({ length: 99 }, (_, i) => `/uploads/p${i + 1}.webp`);
  const { service, calls } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a', pageCount: 150, previews: ninetyNine })] });
  const two = [image('a.webp', WEBP, 'image/webp'), image('b.webp', WEBP, 'image/webp')];
  await assert.rejects(() => service.appendPreviews('a', two), BadRequestException);
  await assert.rejects(() => service.appendPreviews('a', Array.from({ length: 21 }, (_, i) => image(`${i}.webp`, WEBP, 'image/webp'))), BadRequestException);
  await assert.rejects(() => service.appendPreviews('a', [image('x.png', Buffer.from('<html>'), 'image/png')]), BadRequestException);
  await assert.rejects(() => service.appendPreviews('a', []), BadRequestException);
  await assert.rejects(() => service.appendPreviews('a', [image('c.webp', WEBP, 'image/webp')], 0), BadRequestException);
  assert.deepEqual(calls.saved, [], 'при ошибке ничего не сохраняется');
  const last = await service.appendPreviews('a', [image('c.webp', WEBP, 'image/webp')]);
  assert.equal(last.previews.length, 100, 'сотая картинка — можно');
  await assert.rejects(() => service.appendPreviews('nope', [image('c.webp', WEBP, 'image/webp')]), NotFoundException);
});

test('appendPreviews: запись в базу не удалась — новые файлы удаляются, прежние остаются', async () => {
  const { service, calls, prisma } = setup({ docs: [doc('ГОСТ 4121-96', { id: 'a', previews: ['/uploads/old.webp'] })] });
  prisma.normDocument.update = async () => { throw new Error('база недоступна'); };
  await assert.rejects(() => service.appendPreviews('a', [image('1.png', PNG, 'image/png')]), /база недоступна/);
  assert.deepEqual(calls.deleted, ['/uploads/img-1.png']);
});

// Параллельные загрузки страниц: мини-Prisma с общим состоянием, каждая операция отдаёт ход другим запросам.
// Транзакции сами по себе НЕ упорядочены (как READ COMMITTED в Postgres); очередь даёт только замок
// pg_advisory_xact_lock, взятый через $executeRaw, — он держится до конца транзакции.
function setupShared(initial) {
  const rows = new Map(initial.map((d) => [d.id, { ...d, previews: [...d.previews] }]));
  const saved = [];
  const deleted = [];
  const locks = new Map();
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const read = (id) => { const row = rows.get(id); return row ? { ...row, previews: [...row.previews] } : null; };
  const normDocument = {
    async findUnique({ where }) { await tick(); return read(where.id); },
    async update({ where, data }) {
      await tick();
      if (!rows.has(where.id)) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      rows.set(where.id, { ...rows.get(where.id), ...data, previews: [...(data.previews ?? rows.get(where.id).previews)] });
      return read(where.id);
    },
    async delete({ where }) { await tick(); const row = read(where.id); rows.delete(where.id); return row; },
  };
  const prisma = {
    normDocument,
    async $transaction(fn) {
      const held = [];
      const tx = {
        normDocument,
        async $executeRaw(strings, ...values) {
          if (!strings.join('?').includes('pg_advisory_xact_lock')) return 0;
          const key = values.join('|');
          const prev = locks.get(key) ?? Promise.resolve();
          let release;
          const mine = new Promise((resolve) => { release = resolve; });
          locks.set(key, prev.then(() => mine));
          held.push(release);
          await prev;
          return 0;
        },
      };
      try { return await fn(tx); } finally { held.forEach((release) => release()); }
    },
    async $executeRaw() { return 0; },
  };
  let seq = 0;
  const files = {
    async saveFile(file) { await tick(); const path = `/uploads/${file.originalname}-${++seq}`; saved.push(path); return path; },
    async deleteFile(path) { await tick(); deleted.push(path); },
  };
  // Файлы на диске: прежние и сохранённые, кроме удалённых.
  const onDisk = () => [...initial.flatMap((d) => d.previews), ...saved].filter((p) => !deleted.includes(p));
  return { service: new NormativService(prisma, files), rows, saved, deleted, onDisk };
}

// Ни одного удалённого файла в списке и ни одного файла на диске без записи.
function assertConsistent(state, id) {
  const list = state.rows.get(id)?.previews ?? [];
  assert.deepEqual(list.filter((p) => state.deleted.includes(p)), [], 'в списке нет удалённых файлов');
  assert.deepEqual(state.onDisk().filter((p) => !list.includes(p)).sort(), [], 'на диске нет файлов без записи');
}

test('appendPreviews: две пачки одновременно — в списке все страницы, файлов без записи нет', async () => {
  const state = setupShared([doc('ГОСТ 4121-96', { id: 'a', previews: ['/uploads/p1.webp'] })]);
  await Promise.all([
    state.service.appendPreviews('a', [image('a1.webp', WEBP, 'image/webp'), image('a2.webp', WEBP, 'image/webp')]),
    state.service.appendPreviews('a', [image('b1.webp', WEBP, 'image/webp'), image('b2.webp', WEBP, 'image/webp')]),
  ]);
  const list = state.rows.get('a').previews;
  assert.equal(list.length, 5, 'обе пачки в списке');
  assert.equal(list[0], '/uploads/p1.webp');
  assert.deepEqual([...list].sort(), ['/uploads/p1.webp', ...state.saved].sort());
  assertConsistent(state, 'a');
});

test('appendPreviews: две пачки одновременно не обходят предел 100 — лишняя отклоняется, её файл удаляется', async () => {
  const ninetyNine = Array.from({ length: 99 }, (_, i) => `/uploads/p${i + 1}.webp`);
  const state = setupShared([doc('ГОСТ 4121-96', { id: 'a', previews: ninetyNine })]);
  const results = await Promise.allSettled([
    state.service.appendPreviews('a', [image('a.webp', WEBP, 'image/webp')]),
    state.service.appendPreviews('a', [image('b.webp', WEBP, 'image/webp')]),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.ok(results.find((r) => r.status === 'rejected').reason instanceof BadRequestException);
  assert.equal(state.rows.get('a').previews.length, 100);
  assertConsistent(state, 'a');
});

test('PUT во время POST и POST во время PUT: в списке нет удалённых файлов, файлов без записи нет', async () => {
  for (const putFirst of [true, false]) {
    const state = setupShared([doc('ГОСТ 4121-96', { id: 'a', previews: ['/uploads/old1.webp', '/uploads/old2.webp'] })]);
    const put = () => state.service.setPreviews('a', [image('new1.webp', WEBP, 'image/webp')], 5);
    const post = () => state.service.appendPreviews('a', [image('more.webp', WEBP, 'image/webp')]);
    await Promise.all(putFirst ? [put(), post()] : [post(), put()]);
    const list = state.rows.get('a').previews;
    assert.ok(!list.includes('/uploads/old1.webp') && !list.includes('/uploads/old2.webp'), 'старые картинки ушли из списка');
    assert.ok(state.deleted.includes('/uploads/old1.webp') && state.deleted.includes('/uploads/old2.webp'), 'и удалены с диска');
    assertConsistent(state, 'a');
  }
});

test('удаление документа во время POST: файлов без записи не остаётся', async () => {
  const later = (ticks, action) => (ticks ? new Promise((resolve) => setImmediate(resolve)).then(() => later(ticks - 1, action)) : action());
  for (let delay = 0; delay <= 5; delay++) {
    const state = setupShared([doc('ГОСТ 4121-96', { id: 'a', previews: ['/uploads/p1.webp'] })]);
    const results = await Promise.allSettled([
      state.service.appendPreviews('a', [image('a.webp', WEBP, 'image/webp')]),
      later(delay, () => state.service.delete('a')),
    ]);
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(state.rows.has('a'), false);
    assert.deepEqual(state.onDisk(), [], `ни одного файла документа на диске (удаление через ${delay} хода)`);
  }
});
