// Очистка HTML статьи из админки и разбор меток [[CARD …]] / [[SERVICE …]].

const URL_ATTRS = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
]);
// Управляющие символы и пробелы браузер игнорирует внутри схемы URL, поэтому их нужно убрать до проверки.
// eslint-disable-next-line no-control-regex
const SCHEME_NOISE = /[\x00-\x20]+/g;
const NAMED_ENTITIES: Record<string, string> = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  nbsp: ' ',
};

// Раскрывает числовые и несколько именованных сущностей, чтобы схему нельзя было спрятать в &#106;avascript:.
function decodeEntities(value: string): string {
  let prev: string;
  let out = value;
  do {
    prev = out;
    out = out
      .replace(/&#x([0-9a-f]+);?/gi, (m, h: string) =>
        safeChar(parseInt(h, 16), m),
      )
      .replace(/&#(\d+);?/g, (m, d: string) => safeChar(parseInt(d, 10), m))
      .replace(
        /&([a-z]+);/gi,
        (m, n: string) => NAMED_ENTITIES[n.toLowerCase()] ?? m,
      );
  } while (out !== prev);
  return out;
}

function safeChar(code: number, fallback: string): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

function isUnsafeUrl(rawValue: string): boolean {
  let value = rawValue.trim();
  if (/^(["']).*\1$/s.test(value)) value = value.slice(1, -1);
  const normalized = decodeEntities(value)
    .replace(SCHEME_NOISE, '')
    .toLowerCase();
  if (
    normalized.startsWith('javascript:') ||
    normalized.startsWith('vbscript:')
  )
    return true;
  return (
    normalized.startsWith('data:') && !normalized.startsWith('data:image/')
  );
}

// Имя атрибута в выходе — только такого вида; всё остальное (кавычки, «<», «=», скобки) отбрасываем.
const ATTR_NAME = /^[a-z][a-z0-9:-]*$/;

// Значение без внешних парных кавычек; непарная кавычка остаётся частью значения.
function attrValue(raw: string): string {
  return /^(["']).*\1$/s.test(raw) ? raw.slice(1, -1) : raw;
}

// Каждый оставленный атрибут пишем заново как name="value": кавычка из значения не может
// остаться открытой и утащить следующий текст в атрибуты.
function cleanTag(name: string, rest: string): string {
  const attrs: string[] = [];
  const attrRe = /([^\s/"'=<>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
  for (const m of rest.matchAll(attrRe)) {
    const attrName = m[1].toLowerCase();
    if (!ATTR_NAME.test(attrName)) continue;
    if (attrName.startsWith('on') || attrName === 'srcdoc') continue;
    if (m[2] === undefined) {
      attrs.push(attrName);
      continue;
    }
    const value = attrValue(m[2]);
    if (URL_ATTRS.has(attrName) && isUnsafeUrl(value)) continue;
    // «"», «<» и «>» — сущностями: браузер раскроет их обратно, смысл значения тот же.
    const encoded = value
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    attrs.push(`${attrName}="${encoded}"`);
  }
  const selfClose = /\/\s*$/.test(rest) ? ' /' : '';
  return '<' + name + attrs.map((a) => ' ' + a).join('') + selfClose + '>';
}

// Элементы, которые убираем вместе с содержимым: исполняемые, «сырой» текст (внутри них браузер
// читает разметку иначе, чем мы), svg/math (анимация <set>/<animate> подменяет ссылку) и служебные.
const DROP_TAGS =
  'script|style|iframe|frame|frameset|object|embed|applet|svg|math|noscript|textarea|title|xmp|noembed|noframes|plaintext|template|base|meta|link';
const DROP_PAIRED = new RegExp(
  String.raw`<(${DROP_TAGS})(?![a-z0-9])[^>]*>[^]*?<\/\1\s*>`,
  'gi',
);
const DROP_SINGLE = new RegExp(
  String.raw`<\/?(?:${DROP_TAGS})(?![a-z0-9])[^>]*>`,
  'gi',
);
const DROP_LEFTOVER = new RegExp(
  String.raw`<(?=\/?(?:${DROP_TAGS})(?![a-z0-9]))`,
  'gi',
);
// Комментарий по правилам браузера: <!--> и <!---> пустые, иначе до первого --> или --!>, либо до конца.
const COMMENT = /<!--(?:-?>|[^]*?(?:--!?>|$))/g;
// Закрывающий тег без атрибутов | открывающий тег с парными кавычками | любой другой «<».
// Имя тега — только латиница, цифры и дефис; «<a"b>» и подобное уходит в текст.
const TOKEN =
  /<\/([a-z][a-z0-9-]*)\s*>|<([a-z][a-z0-9-]*)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^>"'])*)>|</gi;

export function cleanArticleHtml(html: string): string {
  let out = String(html ?? '').replace(/\r\n?/g, '\n');
  // Опасные элементы вместе с содержимым, затем одиночные/незакрытые остатки.
  // Повторяем до стабильного результата: вложение <scr<script>ipt> иначе собирается заново.
  for (let i = 0; i < 20; i++) {
    const before = out;
    out = out.replace(DROP_PAIRED, '').replace(DROP_SINGLE, '');
    out = out.replace(COMMENT, '');
    if (out === before) break;
  }
  // Страховка: если после лимита что-то осталось, убираем сам «<».
  out = out.replace(DROP_LEFTOVER, '');
  // Один проход слева направо: в выход попадают только вычищенные теги; «<», с которого тег
  // не разобрался (непарная кавычка, <!, <?, «a < b»), становится текстом &lt;.
  return out.replace(
    TOKEN,
    (token, closeName?: string, openName?: string, rest?: string) => {
      if (closeName !== undefined) return token;
      if (openName !== undefined) return cleanTag(openName, rest ?? '');
      return '&lt;';
    },
  );
}

export function articleSkus(body: string): string[] {
  const result: string[] = [];
  for (const mark of String(body ?? '').matchAll(/\[\[CARD\s+([^\]]*)\]\]/g)) {
    // Часть в {…} — подписи характеристик, артикулы там не ищем.
    const head = mark[1].replace(/\{[^}]*\}/g, ' ');
    for (const sku of head.match(/TM-\d{4}/g) ?? []) {
      if (!result.includes(sku)) result.push(sku);
    }
  }
  return result;
}

export function articleServiceSlugs(body: string): string[] {
  const result: string[] = [];
  for (const mark of String(body ?? '').matchAll(
    /\[\[SERVICE\s+([a-z0-9-]+)\s*\]\]/gi,
  )) {
    if (!result.includes(mark[1])) result.push(mark[1]);
  }
  return result;
}
