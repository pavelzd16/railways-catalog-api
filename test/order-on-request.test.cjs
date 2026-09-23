const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
const { OrderService } = require('../dist/src/order/order.service');

function setup(products) {
  const created = [];
  const prisma = {
    product: { async findMany({ where }) { return products.filter((product) => where.id.in.includes(product.id)); } },
    order: {
      async findFirst() { return null; },
      async create({ data }) {
        created.push(data);
        return { id: 'o', ...data, items: data.items.create.map((item, index) => ({ id: `i${index}`, ...item })) };
      },
    },
  };
  const notify = { orderCreated: () => Promise.resolve() };
  return { service: new OrderService(prisma, notify), created };
}

// Каталог ВСП весь «по запросу»: цена либо null, либо 0.
const onRequest = { id: 'p1', title: 'Болт закладной М22х175 в сборе', sku: 'SKU1', slug: 'bolt', price: null, stock: 100, images: [] };
const zeroPrice = { id: 'p2', title: 'Накладка Р65 двухголовая', sku: 'SKU2', slug: 'plate', price: 0, stock: 100, images: [] };
const priced = { id: 'p3', title: 'Рельс Р65', sku: 'SKU3', slug: 'rail', price: 250, stock: 100, images: ['/uploads/rail.png'] };
// Остаток у почти всех позиций каталога равен единице, это заполнитель, а не склад.
const scarce = { id: 'p4', title: 'Подкладка КБ65', sku: 'SKU4', slug: 'pad', price: null, stock: 1, images: [] };
const outOfStock = { id: 'p5', title: 'Противоугон П65', sku: 'SKU5', slug: 'anticreeper', price: null, stock: 0, images: [] };

function order(items) {
  return { name: 'Иван Иванов', phone: '+7 (843) 259-73-00', policyAccepted: true, items };
}

test('cart of products priced on request becomes an order', async () => {
  const { service, created } = setup([onRequest, zeroPrice]);
  const result = await service.create(order([{ productId: 'p1', quantity: 12 }, { productId: 'p2', quantity: 4 }]));
  assert.equal(result.orderNumber, `ORD-${new Date().getFullYear()}-00001`);
  assert.equal(created[0].totalAmount, 0);
  assert.deepEqual(created[0].items.create.map((item) => item.price), [0, 0]);
  assert.deepEqual(created[0].items.create.map((item) => item.quantity), [12, 4]);
});

test('order total counts only the items that have a price', async () => {
  const { service, created } = setup([onRequest, priced]);
  await service.create(order([{ productId: 'p1', quantity: 12 }, { productId: 'p3', quantity: 2 }]));
  assert.equal(created[0].totalAmount, 500);
});

test('order still refuses an empty cart, unknown products and non-positive quantity', async () => {
  const { service } = setup([onRequest]);
  await assert.rejects(service.create(order([])), (error) => error.getStatus() === 400);
  await assert.rejects(service.create(order([{ productId: 'missing', quantity: 1 }])), (error) => error.getStatus() === 404);
  await assert.rejects(service.create(order([{ productId: 'p1', quantity: 0 }])), (error) => error.getStatus() === 400);
});

test('quantity beyond the recorded stock is a request, not a refusal', async () => {
  const { service, created } = setup([scarce, outOfStock]);
  await service.create(order([{ productId: 'p4', quantity: 500 }, { productId: 'p5', quantity: 20 }]));
  assert.deepEqual(created[0].items.create.map((item) => item.quantity), [500, 20]);
  assert.deepEqual(created[0].items.create.map((item) => item.productTitle), ['Подкладка КБ65', 'Противоугон П65']);
});
