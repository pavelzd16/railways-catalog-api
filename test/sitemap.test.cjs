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
    article: { findMany: async () => [] }, normDocument: { findMany: async () => [] },
    category: { findMany: async () => [{ slug: 'rails&more', subcategories: [] }] },
  });
  const xml = await seo.sitemap();
  assert.match(xml, /https:\/\/catalog\.example\/catalog\/rails\/product\/rail/);
  assert.match(xml, /https:\/\/catalog\.example\/services\/cutting/);
  assert.match(xml, /2026-03-01T12:30:00.000Z/);
  assert.ok(xml.includes('<loc>https://catalog.example/calculator</loc>'), 'страница калькулятора должна быть в карте сайта');
  assert.ok(!xml.includes('/admin') && !xml.includes('/cart'));
  assert.equal((xml.match(/<lastmod>/g) || []).length, (xml.match(/<url>/g) || []).length, 'lastmod у каждого адреса');
  assert.match(seo.robots(), /Sitemap: https:\/\/catalog\.example\/sitemap.xml/);
});
test('robots allows AI crawlers by name and keeps Sitemap as the last line', () => {
  const robots = new SeoService({}).robots();
  for (const bot of ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'YandexGPTBot', 'Google-Extended']) {
    assert.ok(robots.includes(`User-agent: ${bot}\nAllow: /\n`), `разрешение для ${bot}`);
  }
  assert.ok(robots.startsWith('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /cart\n'));
  assert.ok(robots.endsWith('\n\nSitemap: https://catalog.example/sitemap.xml\n'));
});
test('sitemap lists the catalog tree on static addresses, as the site canonical', async () => {
  let query;
  const seo = new SeoService({
    product: { findMany: async () => [] },
    service: { findMany: async () => [] },
    article: { findMany: async () => [] }, normDocument: { findMany: async () => [] },
    category: { findMany: async (args) => { query = args; return [{ slug: 'rails', subcategories: [{ slug: 'r-65' }, { slug: 'узкая' }] }, { slug: 'bolts', subcategories: [] }]; } },
  });
  const xml = await seo.sitemap();
  assert.ok(xml.includes('<loc>https://catalog.example/catalog/rails</loc>'));
  assert.ok(xml.includes('<loc>https://catalog.example/catalog/rails/r-65</loc>'));
  assert.ok(xml.includes('<loc>https://catalog.example/catalog/rails/%D1%83%D0%B7%D0%BA%D0%B0%D1%8F</loc>'));
  assert.ok(xml.includes('<loc>https://catalog.example/catalog/bolts</loc>'));
  assert.ok(!/<loc>[^<]*[?=]/.test(xml), 'в карте нет адресов с параметрами');
  assert.deepEqual(query.select.subcategories.where, { products: { some: {} } }, 'empty subcategories stay out of the sitemap');
});
test('large catalogs split into valid sitemap chunks', async () => {
  const seo = new SeoService({
    product: { findMany: async () => Array.from({ length: 45001 }, (_, index) => ({ slug: `p-${index}`, category: { slug: 'rails' }, subcategory: null, updatedAt: new Date('2026-01-01') })) },
    service: { findMany: async () => [] },
    article: { findMany: async () => [] }, normDocument: { findMany: async () => [] }, category: { findMany: async () => [] },
  });
  assert.match(await seo.sitemap(), /<sitemapindex/);
  assert.equal(((await seo.sitemap(1)).match(/<url>/g) || []).length, 45000);
  // 10 статических адресов (с /stati и /normativ) + 45001 товар: на вторую часть приходится 11.
  assert.equal(((await seo.sitemap(2)).match(/<url>/g) || []).length, 11);
  await assert.rejects(seo.sitemap(3), error => error.getStatus() === 404);
});
test('every sitemap address has lastmod: categories take their newest product, pages the newest catalog change', async () => {
  const day = (value) => new Date(`2026-09-${value}T10:00:00Z`);
  const seo = new SeoService({
    product: { findMany: async () => [
      { slug: 'r65-new', category: { slug: 'rails' }, subcategory: { slug: 'r-65' }, updatedAt: day(10) },
      { slug: 'r65-old', category: { slug: 'rails' }, subcategory: { slug: 'r-65' }, updatedAt: day('05') },
      { slug: 'r50', category: { slug: 'rails' }, subcategory: { slug: 'r-50' }, updatedAt: day(20) },
      { slug: 'bolt', category: { slug: 'bolts' }, subcategory: null, updatedAt: day(12) },
    ] },
    service: { findMany: async () => [{ slug: 'cutting', updatedAt: day(25) }, { slug: 'welding', updatedAt: day('01') }] },
    article: { findMany: async () => [] }, normDocument: { findMany: async () => [] },
    category: { findMany: async () => [
      { slug: 'rails', subcategories: [{ slug: 'r-50' }, { slug: 'r-65' }] },
      { slug: 'bolts', subcategories: [] },
      { slug: 'empty', subcategories: [] },
    ] },
  });
  const xml = await seo.sitemap();
  const lastmod = (path) => {
    const loc = `<loc>https://catalog.example${path.replaceAll('&', '&amp;')}</loc><lastmod>`;
    const start = xml.indexOf(loc);
    return start < 0 ? undefined : xml.slice(start + loc.length, xml.indexOf('</lastmod>', start));
  };
  assert.equal(lastmod('/catalog/rails'), day(20).toISOString());
  assert.equal(lastmod('/catalog/rails/r-65'), day(10).toISOString());
  assert.equal(lastmod('/catalog/rails/r-50'), day(20).toISOString());
  assert.equal(lastmod('/catalog/bolts'), day(12).toISOString());
  assert.equal(lastmod('/catalog/empty'), day(25).toISOString(), 'пустой раздел — дата последнего изменения каталога');
  assert.equal(lastmod('/services'), day(25).toISOString());
  for (const path of ['/', '/catalog', '/about', '/contacts', '/delivery', '/calculator', '/privacy', '/normativ'])
    assert.equal(lastmod(path), day(25).toISOString(), path);
  assert.equal((xml.match(/<lastmod>/g) || []).length, (xml.match(/<url>/g) || []).length);
});
test('robots.txt closes the cart and tells Yandex to ignore tracking parameters, keeping category filters', () => {
  const robots = new SeoService({}).robots();
  assert.ok(robots.includes('Disallow: /admin\n'));
  assert.ok(robots.includes('Disallow: /cart\n'));
  assert.ok(robots.includes('Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&from\n'));
  assert.ok(robots.includes('Clean-param: search&gost&priceMin&priceMax&condition&stock&sort&limit /catalog\n'));
  assert.ok(!/category|subcategory|page/.test(robots), 'старые адреса разделов должны дойти до 301, страницы — до своего canonical');
  assert.match(robots, /Sitemap: https:\/\/catalog\.example\/sitemap.xml\n$/);
});
test('a category name repeated in two sections gets the date of its own products', async () => {
  const day = (value) => new Date(`2026-09-${value}T10:00:00Z`);
  const seo = new SeoService({
    product: { findMany: async () => [
      { slug: 'a', category: { slug: 'rails' }, subcategory: { slug: 'new' }, updatedAt: day(10) },
      { slug: 'b', category: { slug: 'bolts' }, subcategory: { slug: 'new' }, updatedAt: day(20) },
    ] },
    service: { findMany: async () => [] },
    article: { findMany: async () => [] }, normDocument: { findMany: async () => [] },
    category: { findMany: async () => [{ slug: 'rails', subcategories: [{ slug: 'new' }] }, { slug: 'bolts', subcategories: [{ slug: 'new' }] }] },
  });
  const xml = await seo.sitemap();
  assert.ok(xml.includes(`<loc>https://catalog.example/catalog/rails/new</loc><lastmod>${day(10).toISOString()}</lastmod>`));
  assert.ok(xml.includes(`<loc>https://catalog.example/catalog/bolts/new</loc><lastmod>${day(20).toISOString()}</lastmod>`));
});
test('published articles are listed under /stati with their own lastmod; the section date is the newest article', async () => {
  const updatedAt = new Date('2026-10-20T09:00:00Z');
  let query;
  const seo = new SeoService({
    product: { findMany: async () => [] },
    service: { findMany: async () => [] },
    article: { findMany: async (args) => { query = args; return [{ slug: 'relsy-r65', updatedAt }]; } },
    normDocument: { findMany: async () => [] },
    category: { findMany: async () => [] },
  });
  const xml = await seo.sitemap();
  assert.ok(xml.includes('<loc>https://catalog.example/stati</loc>'));
  assert.ok(xml.includes(`<loc>https://catalog.example/stati/relsy-r65</loc><lastmod>${updatedAt.toISOString()}</lastmod>`));
  assert.ok(xml.includes(`<loc>https://catalog.example/stati</loc><lastmod>${updatedAt.toISOString()}</lastmod>`), '/stati — дата самой свежей статьи');
  assert.equal(query.where.published, true, 'в карту попадают только опубликованные статьи');
});
test('published norm documents are listed under /normativ with their own lastmod; the section date is the newest document', async () => {
  const updatedAt = new Date('2026-10-23T09:00:00Z');
  let query;
  const seo = new SeoService({
    product: { findMany: async () => [] },
    service: { findMany: async () => [] },
    article: { findMany: async () => [] },
    normDocument: { findMany: async (args) => { query = args; return [{ slug: 'gost-4121-96', updatedAt }]; } },
    category: { findMany: async () => [] },
  });
  const xml = await seo.sitemap();
  assert.ok(xml.includes(`<loc>https://catalog.example/normativ</loc><lastmod>${updatedAt.toISOString()}</lastmod>`), '/normativ — дата самого свежего документа');
  assert.ok(xml.includes(`<loc>https://catalog.example/normativ/gost-4121-96</loc><lastmod>${updatedAt.toISOString()}</lastmod>`));
  assert.equal(query.where.published, true, 'в карту попадают только опубликованные документы');
});
