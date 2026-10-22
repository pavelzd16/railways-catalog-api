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

test('cleanArticleHtml: схема javascript: в сущностях не проходит', () => {
  for (const h of [
    '<a href="&#106;avascript:a()">x</a>',
    '<a href="jav&#x09;ascript:a()">x</a>',
    '<a href="javascript&colon;a()">x</a>',
    '<a href="jav&Tab;ascript:a()">x</a>',
    '<a href="jav&NewLine;ascript:a()">x</a>',
    '<a href=" javascript:x">x</a>',
    '<a href="JaVaScRiPt:x">x</a>',
  ]) assert.ok(!/javascript|href/i.test(cleanArticleHtml(h).replace(/>x<.*/, '')), h);
});
test('cleanArticleHtml: on* после / и после кавычки, любой регистр', () => {
  assert.ok(!/onerror/i.test(cleanArticleHtml('<img/onerror=a()>')));
  assert.ok(!/onclick/i.test(cleanArticleHtml('<a href="x"onclick=a()>q</a>')));
  assert.ok(cleanArticleHtml('<a href="x"onclick=a()>q</a>').includes('href="x"'));
  assert.ok(!/onerror/i.test(cleanArticleHtml('<img src=x ONERROR=a()>')));
  assert.ok(!/onclick/i.test(cleanArticleHtml('<a title=">" onclick=a()>q</a>')));
});
test('cleanArticleHtml: action, formaction, xlink:href, srcdoc', () => {
  assert.ok(!/javascript/i.test(cleanArticleHtml('<form action="javascript:a()"><button formaction="javascript:a()">')));
  assert.ok(!/javascript/i.test(cleanArticleHtml('<svg><a xlink:href="javascript:a()">x</a></svg>')));
  assert.ok(!/srcdoc/i.test(cleanArticleHtml('<div srcdoc="<b>x</b>">q</div>')));
  assert.ok(cleanArticleHtml('<a href="/stati/x" class="c">ok</a>').includes('href="/stati/x" class="c"'));
});
test('cleanArticleHtml: <SCRIPT> в верхнем регистре', () => {
  assert.equal(cleanArticleHtml('a<SCRIPT>alert(1)</SCRIPT>b'), 'ab');
});

test('cleanArticleHtml: вложенные теги не собираются заново', () => {
  for (const h of ['<scr<script>ipt>alert(1)</scr<script>ipt>', '<scr<script>ipt>alert(1)', '<ifr<iframe>ame src=x>']) {
    assert.ok(!/<\/?(script|style|iframe|object|embed)/i.test(cleanArticleHtml(h)), h);
  }
});
