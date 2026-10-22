const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanArticleHtml, articleSkus, articleServiceSlugs } = require('../dist/src/article/article-html');

test('cleanArticleHtml убирает скрипты, on*-атрибуты и javascript:', () => {
  const out = cleanArticleHtml('<p onclick="x()">а</p><script>alert(1)</script><a href="javascript:x">b</a><img src=x onerror=alert(1)>');
  for (const bad of ['script', 'onclick', 'onerror', 'javascript:']) assert.ok(!out.includes(bad), bad);
  assert.ok(out.includes('<p>а</p>'));
});
test('cleanArticleHtml убирает style/iframe/object/embed и data: кроме картинок', () => {
  const out = cleanArticleHtml('<style>a{}</style><iframe src="x">t</iframe><object>o</object><embed src="y"><a href="data:text/html,x">l</a>ok');
  assert.equal(out, '<a>l</a>ok');
});
test('cleanArticleHtml сохраняет data:image', () => {
  assert.ok(cleanArticleHtml('<img src="data:image/png;base64,AAA">').includes('data:image/png'));
});
test('cleanArticleHtml приводит переводы строк к \n', () => {
  assert.equal(cleanArticleHtml('a\r\nb'), 'a\nb');
});
test('articleSkus собирает артикулы по порядку без повторов', () => {
  assert.deepEqual(
    articleSkus('[[CARD TM-0747 TM-0039{Высота|Масса 1 м}]] x [[CARD TM-0039]] [[CARD TM-0051{Ширина головки}]]'),
    ['TM-0747', 'TM-0039', 'TM-0051'],
  );
});
test('articleServiceSlugs читает slug услуг', () => {
  assert.deepEqual(
    articleServiceSlugs('[[SERVICE rezka-rels]] [[SERVICE izgotovlenie-tupikovyh-uporov]]'),
    ['rezka-rels', 'izgotovlenie-tupikovyh-uporov'],
  );
});
