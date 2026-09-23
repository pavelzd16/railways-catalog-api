const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
process.env.DOTENV_CONFIG_QUIET = 'true';
const { RequestService } = require('../dist/src/request/request.service');

function setup() {
  const asked = [];
  const prisma = {
    request: {
      async findMany({ where }) { asked.push(where); return []; },
      async count({ where }) { return 0; },
    },
  };
  return { service: new RequestService(prisma, {}), asked };
}

const query = (extra) => ({ page: 1, limit: 20, skip: 0, take: 20, ...extra });

// Админка делит заявки на «по услуге» и «по товару». Раньше этот отбор жил в браузере
// и видел только загруженную страницу, поэтому он должен стать условием запроса к базе.
test('requests are filtered by kind in the database', async () => {
  const { service, asked } = setup();
  await service.findAll(query({ type: 'service' }));
  assert.deepEqual(asked[0], { serviceId: { not: null } });

  await service.findAll(query({ type: 'product' }));
  assert.deepEqual(asked[1], { productId: { not: null } });
});

test('kind filter combines with search and leaves the rest untouched', async () => {
  const { service, asked } = setup();
  await service.findAll(query({ type: 'product', search: 'Иванов' }));
  assert.deepEqual(asked[0].productId, { not: null });
  assert.equal(asked[0].OR.length, 4);

  await service.findAll(query({}));
  assert.deepEqual(asked[1], {});
});
