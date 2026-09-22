const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SITE_URL = 'https://catalog.example';
const { SeoService } = require('../dist/src/seo/seo.service');
const { getSiteUrl, productPath, escapeXml } = require('../dist/src/seo/site-url');

test('URL paths support products with and without a subcategory', () => {
  assert.equal(productPath({ category: { slug: 'rails' }, subcategory: null, slug: 'rail-50' }), '/catalog/rails/product/rail-50');
  assert.equal(productPath({ category: { slug: 'rails' }, subcategory: { slug: 'new' }, slug: 'рельс' }), '/catalog/rails/new/product/%D1%80%D0%B5%D0%BB%D1%8C%D1%81');
  assert.equal(escapeXml('a&b<"\'>'), 'a&amp;b&lt;&quot;&apos;&gt;');
});
test('site origin comes from configuration and refuses paths or credentials', () => {
  assert.equal(getSiteUrl(), 'https://catalog.example');
  for (const value of ['https://host/path', 'https://user:pass@host', 'file:///tmp', 'https://host/?secret=1']) {
    process.env.SITE_URL = value;
    assert.throws(getSiteUrl);
  }
  process.env.SITE_URL = 'https://catalog.example';
});
test('sitemap includes database products and services with real update dates, excluding private pages', async () => {
  const updatedAt = new Date('2026-03-01T12:30:00Z');
  const seo = new SeoService({
    product: { findMany: async () => [{ slug: 'rail', category: { slug: 'rails' }, subcategory: null, updatedAt }] },
    service: { findMany: async () => [{ slug: 'cutting', updatedAt }] },
    category: { findMany: async () => [{ slug: 'rails&more', subcategories: [] }] },
  });
  const xml = await seo.sitemap();
  assert.match(xml, /https:\/\/catalog\.example\/catalog\/rails\/product\/rail/);
  assert.match(xml, /https:\/\/catalog\.example\/services\/cutting/);
  assert.match(xml, /2026-03-01T12:30:00.000Z/);
  assert.ok(xml.includes('<loc>https://catalog.example/calculator</loc>'), 'страница калькулятора должна быть в карте сайта');
  assert.ok(!xml.includes('/admin') && !xml.includes('/cart'));
  assert.equal((xml.match(/<lastmod>/g) || []).length, 2);
  assert.match(seo.robots(), /Sitemap: https:\/\/catalog\.example\/sitemap.xml/);
});
test('sitemap lists subcategory pages with the same query order as the site canonical', async () => {
  let query;
  const seo = new SeoService({
    product: { findMany: async () => [] },
    service: { findMany: async () => [] },
    category: { findMany: async (args) => { query = args; return [{ slug: 'rails', subcategories: [{ slug: 'r-65' }, { slug: 'узкая' }] }, { slug: 'bolts', subcategories: [] }]; } },
  });
  const xml = await seo.sitemap();
  assert.match(xml, /<loc>https:\/\/catalog\.example\/catalog\?category=rails<\/loc>/);
  assert.match(xml, /<loc>https:\/\/catalog\.example\/catalog\?category=rails&amp;subcategory=r-65<\/loc>/);
  assert.ok(xml.includes('category=rails&amp;subcategory=%D1%83%D0%B7%D0%BA%D0%B0%D1%8F'));
  assert.equal((xml.match(/subcategory=/g) || []).length, 2);
  assert.deepEqual(query.select.subcategories.where, { products: { some: {} } }, 'empty subcategories stay out of the sitemap');
});
test('large catalogs split into valid sitemap chunks', async () => {
  const seo = new SeoService({
    product: { findMany: async () => Array.from({ length: 45001 }, (_, index) => ({ slug: `p-${index}`, category: { slug: 'rails' }, subcategory: null, updatedAt: new Date('2026-01-01') })) },
    service: { findMany: async () => [] }, category: { findMany: async () => [] },
  });
  assert.match(await seo.sitemap(), /<sitemapindex/);
  assert.equal(((await seo.sitemap(1)).match(/<url>/g) || []).length, 45000);
  assert.equal(((await seo.sitemap(2)).match(/<url>/g) || []).length, 10);
  await assert.rejects(seo.sitemap(3), error => error.getStatus() === 404);
});
