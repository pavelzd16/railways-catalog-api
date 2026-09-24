const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
process.env.DOTENV_CONFIG_QUIET = 'true';
const { orderLetter, requestLetter, SUBJECT_TAG } = require('../dist/src/notify/notify-letters');
const { NotifyService } = require('../dist/src/notify/notify.service');
const { OrderService } = require('../dist/src/order/order.service');
const { RequestService } = require('../dist/src/request/request.service');

const SITE = 'https://traer.ru';

const order = {
  orderNumber: 'ORD-2026-00012',
  name: 'Иван Иванов',
  phone: '+7 (843) 259-73-00',
  email: 'ivan@example.ru',
  address: 'Казань, ул. Путейская, 1',
  comment: 'Нужна доставка до станции',
  totalAmount: 1500000,
  items: [
    { productTitle: 'Болт закладной М22х175 в сборе', productSku: 'SKU1', quantity: 12, price: 0 },
    { productTitle: 'Рельс Р65', productSku: 'SKU3', quantity: 2, price: 750000 },
  ],
};

const request = {
  name: 'Пётр Петров',
  phone: '+7 (965) 615-50-59',
  email: null,
  comment: 'Перезвоните после обеда',
  product: { title: 'Накладка Р65 двухголовая', sku: 'SKU2' },
  service: null,
};

// Пользователь раскладывает письма сайта фильтром «Тема содержит [Сайт traer.ru]»,
// а свои письма самому себе — нет. Метка в теме — это договорённость, её не менять.
test('every letter subject starts with the filter tag', () => {
  assert.equal(SUBJECT_TAG, '[Сайт traer.ru]');
  assert.ok(orderLetter(order, SITE).subject.startsWith(`${SUBJECT_TAG} `));
  assert.ok(requestLetter(request, SITE, []).subject.startsWith(`${SUBJECT_TAG} `));
});

test('order letter names the order, the client and every item', () => {
  const letter = orderLetter(order, SITE);
  assert.equal(letter.subject, '[Сайт traer.ru] Заказ № ORD-2026-00012 — Иван Иванов, +7 (843) 259-73-00');
  for (const part of ['Иван Иванов', '+7 (843) 259-73-00', 'ivan@example.ru', 'Казань, ул. Путейская, 1', 'Нужна доставка до станции', 'Болт закладной М22х175 в сборе', 'SKU1', 'Рельс Р65', 'SKU3']) {
    assert.ok(letter.text.includes(part), `в тексте нет «${part}»`);
    assert.ok(letter.html.includes(part), `в html нет «${part}»`);
  }
  assert.match(letter.text, /по запросу/);
  assert.match(letter.text, /1 500 000 руб\./);
  assert.ok(letter.text.includes(`${SITE}/admin/orders`));
  assert.equal(letter.replyTo, 'ivan@example.ru');
});

test('order without any price says the total is on request', () => {
  const letter = orderLetter({ ...order, totalAmount: 0, items: [order.items[0]] }, SITE);
  assert.match(letter.text, /Итого: по запросу/);
});

test('request letter names the product or service it came from', () => {
  const byProduct = requestLetter(request, SITE, []);
  assert.equal(byProduct.subject, '[Сайт traer.ru] Заявка: Накладка Р65 двухголовая — Пётр Петров, +7 (965) 615-50-59');
  assert.ok(byProduct.text.includes('Перезвоните после обеда'));
  assert.ok(byProduct.text.includes(`${SITE}/admin/requests`));
  assert.equal(byProduct.replyTo, undefined);

  const byService = requestLetter({ ...request, product: null, service: { title: 'Укладка пути' } }, SITE, []);
  assert.equal(byService.subject, '[Сайт traer.ru] Заявка: Укладка пути — Пётр Петров, +7 (965) 615-50-59');

  const plain = requestLetter({ ...request, product: null }, SITE, []);
  assert.equal(plain.subject, '[Сайт traer.ru] Заявка — Пётр Петров, +7 (965) 615-50-59');
});

test('files the client attached travel with the request letter', () => {
  const file = { filename: 'Спецификация.xlsx', content: Buffer.from('x') };
  const letter = requestLetter(request, SITE, [file]);
  assert.deepEqual(letter.attachments, [file]);
  assert.ok(letter.text.includes('Спецификация.xlsx'));
});

test('client input cannot inject markup or headers into the letter', () => {
  const letter = requestLetter({ ...request, name: 'Иван <script>alert(1)</script>\r\nBcc: x@y.z', comment: '<b>жирный</b>' }, SITE, []);
  assert.ok(!letter.html.includes('<script>'));
  assert.ok(!letter.html.includes('<b>жирный</b>'));
  assert.ok(letter.html.includes('&lt;b&gt;жирный&lt;/b&gt;'));
  assert.ok(!/[\r\n]/.test(letter.subject));
});

function transportThat(sendMail) {
  const sent = [];
  return { sent, transport: { async sendMail(message) { sent.push(message); return sendMail?.(message); } } };
}

function notifyWith(transport) {
  const service = new NotifyService();
  service.transport = transport;
  service.from = { name: 'Сайт traer.ru', address: 'zakaz@traer.ru' };
  service.to = 'zakaz@traer.ru';
  service.siteUrl = SITE;
  return service;
}

test('letters go from the site mailbox to itself, signed as the site', async () => {
  const { sent, transport } = transportThat();
  await notifyWith(transport).orderCreated(order);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].from, { name: 'Сайт traer.ru', address: 'zakaz@traer.ru' });
  assert.equal(sent[0].to, 'zakaz@traer.ru');
  assert.equal(sent[0].replyTo, 'ivan@example.ru');
  assert.ok(sent[0].subject.startsWith(SUBJECT_TAG));
});

test('a failed send is logged and never reaches the client', async () => {
  const { transport } = transportThat(() => { throw new Error('SMTP недоступен'); });
  const service = notifyWith(transport);
  const logged = [];
  service.logger = { error: (...args) => logged.push(args), warn() {}, log() {} };
  await assert.doesNotReject(service.requestCreated(request, []));
  assert.equal(logged.length, 1);

  // Даже если письмо не удалось собрать, обещание не отклоняется:
  // отклонённое обещание без обработчика роняет весь процесс API.
  await assert.doesNotReject(service.orderCreated({ ...order, items: undefined }));
  assert.equal(logged.length, 2);
});

test('without mailbox settings notifications are off and nothing throws', async () => {
  const service = new NotifyService();
  service.transport = null;
  await assert.doesNotReject(service.orderCreated(order));
});

test('a new order and a new request both trigger a letter', async () => {
  const calls = [];
  const notify = {
    orderCreated: (created) => { calls.push(['order', created]); return Promise.resolve(); },
    requestCreated: (created, files) => { calls.push(['request', created, files]); return Promise.resolve(); },
  };

  const product = { id: 'p3', title: 'Рельс Р65', sku: 'SKU3', slug: 'rail', price: 250, stock: 1, images: [] };
  const orderPrisma = {
    product: { async findMany() { return [product]; } },
    order: {
      async findFirst() { return null; },
      async create({ data }) { return { id: 'o', ...data, items: data.items.create.map((item, index) => ({ id: `i${index}`, ...item })) }; },
    },
  };
  await new OrderService(orderPrisma, notify).create({ name: 'Иван', phone: '+7 (843) 259-73-00', policyAccepted: true, items: [{ productId: 'p3', quantity: 2 }] });
  assert.equal(calls[0][0], 'order');
  assert.equal(calls[0][1].items[0].productTitle, 'Рельс Р65');

  const requestPrisma = {
    product: { async findUnique() { return product; } },
    request: { async create({ data }) { return { id: 'r', ...data, service: null, product }; } },
  };
  const fileService = { async saveFile() { return '/uploads/a.pdf'; } };
  const upload = { originalname: 'Смета.pdf', buffer: Buffer.from('pdf') };
  await new RequestService(requestPrisma, fileService, notify).create({ name: 'Пётр', phone: '+7 (965) 615-50-59', policyAccepted: true, productId: 'p3' }, upload);
  assert.equal(calls[1][0], 'request');
  assert.equal(calls[1][1].product.title, 'Рельс Р65');
  assert.deepEqual(calls[1][2], [{ filename: 'Смета.pdf', content: upload.buffer }]);
});

// Почтовый сервер может отвечать минутами — клиент не должен ждать письма.
test('the order is answered without waiting for the letter', async () => {
  const never = new Promise(() => {});
  const notify = { orderCreated: () => never, requestCreated: () => never };
  const product = { id: 'p3', title: 'Рельс Р65', sku: 'SKU3', slug: 'rail', price: 250, stock: 1, images: [] };
  const prisma = {
    product: { async findMany() { return [product]; } },
    order: {
      async findFirst() { return null; },
      async create({ data }) { return { id: 'o', ...data, items: data.items.create.map((item, index) => ({ id: `i${index}`, ...item })) }; },
    },
  };
  const result = await new OrderService(prisma, notify).create({ name: 'Иван', phone: '+7 (843) 259-73-00', policyAccepted: true, items: [{ productId: 'p3', quantity: 2 }] });
  assert.equal(result.totalAmount, 500);
});
