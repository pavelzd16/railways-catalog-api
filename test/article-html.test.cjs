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

// Проверка «как браузер»: с каждого «<» в выходе начинается тег строгого вида — закрывающий
// </имя> или открывающий, где каждый атрибут name либо name="значение без кавычек", и ни одного on*.
const STRICT_TAG = /<\/[A-Za-z][A-Za-z0-9-]*\s*>|<[A-Za-z][A-Za-z0-9-]*((?:\s+[a-z][a-z0-9:-]*(?:="[^"]*")?)*)\s*\/?>/y;
function assertOnlyCleanTags(out, source) {
  for (let at = out.indexOf('<'); at !== -1; at = out.indexOf('<', at + 1)) {
    STRICT_TAG.lastIndex = at;
    const m = STRICT_TAG.exec(out);
    assert.ok(m, `с позиции ${at} не строгий тег (${JSON.stringify(out.slice(at, at + 60))}) для ${source}`);
    for (const a of (m[1] ?? '').matchAll(/\s+([a-z][a-z0-9:-]*)(?:="[^"]*")?/g)) {
      assert.ok(!a[1].startsWith('on'), `${a[1]} в теге ${m[0]} для ${source}`);
    }
  }
}

test('cleanArticleHtml: тег с непарной кавычкой не проходит в разметку', () => {
  const vectors = {
    '<img src=x onerror=alert(1) title="a>': '&lt;img src=x onerror=alert(1) title="a>',
    '<a href=x onclick="y>q</a>': '&lt;a href=x onclick="y>q</a>',
    "<p title='a onmouseover=alert(1)>t</p>": "&lt;p title='a onmouseover=alert(1)>t</p>",
    '<img src="x" onerror=alert(1) alt=\'>': '&lt;img src="x" onerror=alert(1) alt=\'>',
    '<div class="a" "onclick=alert(1)>t</div>': '&lt;div class="a" "onclick=alert(1)>t</div>',
  };
  for (const [input, expected] of Object.entries(vectors)) {
    const out = cleanArticleHtml(input);
    assert.equal(out, expected, input);
    assertOnlyCleanTags(out, input);
  }
});
test('cleanArticleHtml: после тега с непарной кавычкой следующие теги всё равно чистятся', () => {
  const out = cleanArticleHtml('<a title="x>t <img src=x onerror=alert(1)>');
  assert.equal(out, '&lt;a title="x>t <img src="x">');
});
test('cleanArticleHtml: svg и math удаляются вместе с содержимым', () => {
  for (const h of [
    '<svg><animate attributeName="href" to="javascript:alert(1)"/><a><text>x</text></a></svg>',
    '<svg><set attributeName="href" to="javascript:alert(1)"></set></svg>',
    '<SVG viewBox="0 0 1 1"><svg><animate attributeName="href" values="javascript:alert(1)"/></svg></SVG>',
    '<math><maction actiontype="statusline" xlink:href="javascript:alert(1)">x</maction></math>',
    '<math><mi>x</mi>',
  ]) {
    const out = cleanArticleHtml(`a${h}b`);
    assert.ok(!/<\/?(svg|math|animate|set|maction)/i.test(out), `${h} → ${out}`);
    assert.ok(!/javascript/i.test(out), `${h} → ${out}`);
    assertOnlyCleanTags(out, h);
  }
  assert.equal(cleanArticleHtml('a<svg><rect/></svg>b'), 'ab');
  assert.equal(cleanArticleHtml('a<math><mi>x</mi></math>b'), 'ab');
});
test('cleanArticleHtml: значение атрибута не выходит из «сырого» элемента и комментария', () => {
  for (const h of [
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    '<textarea><p title="</textarea><img src=x onerror=alert(1)>"></textarea>',
    '<title><a title="</title><img src=x onerror=alert(1)>"></title>',
    '<!-- <a title=" --> <img src=x onerror=alert(1)> "> -->',
    '<!-- --!> <img src=x onerror=alert(1)> -->',
    '<?x <a title="> <img src=x onerror=alert(1)>">',
  ]) {
    const out = cleanArticleHtml(h);
    assertOnlyCleanTags(out, h);
    assert.ok(!/<!--|<\/?(noscript|textarea|title)/i.test(out), `${h} → ${out}`);
    // «<» и «>» внутри значений атрибутов экранированы — тег из значения не соберётся ни в каком контексте.
    assert.ok(!/<img[^>]*onerror/i.test(out), `${h} → ${out}`);
  }
});
test('cleanArticleHtml: base, meta и link удаляются', () => {
  assert.equal(cleanArticleHtml('<base href="https://x/"><meta http-equiv="refresh" content="0;url=https://x"><link rel="stylesheet" href="x">t'), 't');
});
test('cleanArticleHtml: обычная разметка статьи не меняется', () => {
  const html = '<h2 id="a">Заголовок</h2>\n<p>Текст <b>жирный</b>, ссылка <a href="/catalog/x" target="_blank">тут</a>.</p>\n'
    + '<div class="tbl"><table>\n<tr><th>Тип</th><td>Р65</td></tr>\n</table></div>\n<figure>\n<img src="data:image/png;base64,AAA" alt="Схема" loading="lazy">\n'
    + '<figcaption>Рис. 1</figcaption>\n</figure>\n[[CARD TM-0039{Высота|Масса 1 м}]]\n[[TOC]]\n<ul><li>a</li></ul><br /><hr />';
  assert.equal(cleanArticleHtml(html), html);
});
test('cleanArticleHtml: «<» в тексте экранируется, в значении атрибута — тоже', () => {
  assert.equal(cleanArticleHtml('a < b, 3<5'), 'a &lt; b, 3&lt;5');
  assert.equal(cleanArticleHtml('<p title="a<b>c">t</p>'), '<p title="a&lt;b&gt;c">t</p>');
});

test('cleanArticleHtml: кавычка в начале значения без пары не открывает атрибут', () => {
  const vectors = {
    // браузер читал бы src="' b>'" и живой onerror
    '<img x" src=\'" b>\' onerror=alert(1)>': '<img x src="\'&quot;" b>\' onerror=alert(1)>',
    // браузер читал бы a="' b>" и живой onmouseover
    '<p x\' a="\' b>"onmouseover=alert(1) >hi': '<p x a="&quot;\'" b>"onmouseover=alert(1) >hi',
  };
  for (const [input, expected] of Object.entries(vectors)) {
    const out = cleanArticleHtml(input);
    assert.equal(out, expected, input);
    assertOnlyCleanTags(out, input);
  }
});
test('cleanArticleHtml: атрибуты пишутся заново как name="value"', () => {
  assert.equal(cleanArticleHtml("<a href='/x' title=a\"b\"c data-n=1 hidden>t</a>"), '<a href="/x" title="a&quot;b&quot;c" data-n="1" hidden>t</a>');
  assert.equal(cleanArticleHtml('<p CLASS="c" x(y)=1 a`b=2 =3>t</p>'), '<p class="c">t</p>');
  assert.equal(cleanArticleHtml('<a"b title="<img src=x onerror=alert(1)>">t'), '&lt;a"b title="<img src="x">">t');
});
test('cleanArticleHtml: в выходе каждый тег строгого вида (атрибуты name="value")', () => {
  const vectors = [
    '<img src=x onerror=alert(1) title="a>', '<a href=x onclick="y>q</a>', "<p title='a onmouseover=alert(1)>t</p>",
    '<img x" src=\'" b>\' onerror=alert(1)>', '<p x\' a="\' b>"onmouseover=alert(1) >hi', '<a title=">" onclick=a()>q</a>',
    '<a href="x"onclick=a()>q</a>', '<img/onerror=a()>', '<div srcdoc="<b>x</b>">q</div>', "<a b='\"' c=\"'\" d=`e`>",
    '<a title=x"y z=\'w>t', '<a = "x">', '<a x=">">', '<!-- <a title=" --> <img src=x onerror=alert(1)> "> -->',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>', '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
    '<a/x/y=z/>', '<br/>', '<input value=a"b"c>', '<a href="&#106;avascript:a()">x</a>',
  ];
  for (const h of vectors) assertOnlyCleanTags(cleanArticleHtml(h), h);
});
