// Карточка товара отдаёт normDocs — опубликованные документы справочника из строки gost.
const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
require('reflect-metadata');
const { ProductService } = require('../dist/src/product/product.service');

function setup(gost, docs) {
  const product = {
    id: 'p', sku: 'TM-0001', slug: 'rels-kr-70', title: 'Рельс КР-70', gost, price: 1, stock: 1, condition: 'NEW',
    images: [], description: null, descriptionTags: null, analogues: [], categoryId: 'c', subcategoryId: null,
    category: { id: 'c', slug: 'kranovye-relsy', name: 'Крановые рельсы', filters: [] }, subcategory: null, specs: [],
  };
  const queries = [];
  const prisma = {
    product: {
      async findUnique() { return product; },
      async findMany() { return []; },
    },
    normDocument: {
      async findMany(args) { queries.push(args); return docs.filter((d) => !args.where?.published || d.published); },
    },
  };
  return { service: new ProductService(prisma, {}), queries };
}

test('normDocs: опубликованные документы из gost по порядку, вместе с заменой; черновики и чужие номера — нет', async () => {
  const docs = [
    { code: 'ГОСТ Р 53866-2010', slug: 'gost-r-53866-2010', published: true },
    { code: 'ГОСТ 4121-96', slug: 'gost-4121-96', published: true },
    { code: 'ГОСТ 4121-2024', slug: 'gost-4121-2024', published: false },
    { code: 'ГОСТ 14121-96', slug: 'gost-14121-96', published: true },
  ];
  const { service, queries } = setup('ГОСТ 4121-96 (заменён на ГОСТ 4121-2024), ГОСТ Р 53866-2010', docs);
  const result = await service.findOneBySlug('rels-kr-70');
  assert.deepEqual(result.normDocs.map((d) => ({ ...d })), [
    { code: 'ГОСТ 4121-96', slug: 'gost-4121-96' },
    { code: 'ГОСТ Р 53866-2010', slug: 'gost-r-53866-2010' },
  ]);
  assert.equal(queries[0].where.published, true);
  assert.equal(result.gost, 'ГОСТ 4121-96 (заменён на ГОСТ 4121-2024), ГОСТ Р 53866-2010');
});

test('normDocs: без gost — пустой список, справочник не запрашивается', async () => {
  const { service, queries } = setup(null, []);
  const result = await service.findOneBySlug('rels-kr-70');
  assert.deepEqual(result.normDocs, []);
  assert.equal(queries.length, 0);
});
