// Очистка HTML статьи из админки и разбор меток [[CARD …]] / [[SERVICE …]].

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);
const NAMED_ENTITIES: Record<string, string> = { colon: ':', tab: '\t', newline: '\n', nbsp: ' ' };

// Раскрывает числовые и несколько именованных сущностей, чтобы схему нельзя было спрятать в &#106;avascript:.
function decodeEntities(value: string): string {
  let prev: string;
  let out = value;
  do {
    prev = out;
    out = out
      .replace(/&#x([0-9a-f]+);?/gi, (m, h: string) => safeChar(parseInt(h, 16), m))
      .replace(/&#(\d+);?/g, (m, d: string) => safeChar(parseInt(d, 10), m))
      .replace(/&([a-z]+);/gi, (m, n: string) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
  } while (out !== prev);
  return out;
}

function safeChar(code: number, fallback: string): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

function isUnsafeUrl(rawValue: string): boolean {
  let value = rawValue.trim();
  if (/^(["']).*\1$/s.test(value)) value = value.slice(1, -1);
  const normalized = decodeEntities(value).replace(/[\x00-\x20]+/g, '').toLowerCase();
  if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) return true;
  return normalized.startsWith('data:') && !normalized.startsWith('data:image/');
}

function cleanTag(tag: string, name: string, rest: string): string {
  const attrs: string[] = [];
  const attrRe = /([^\s\/"'=<>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
  for (const m of rest.matchAll(attrRe)) {
    const attrName = m[1].toLowerCase();
    if (attrName.startsWith('on') || attrName === 'srcdoc') continue;
    if (URL_ATTRS.has(attrName) && m[2] !== undefined && isUnsafeUrl(m[2])) continue;
    attrs.push(m[0]);
  }
  const selfClose = /\/\s*$/.test(rest) ? ' /' : '';
  void tag;
  return '<' + name + attrs.map((a) => ' ' + a).join('') + selfClose + '>';
}

export function cleanArticleHtml(html: string): string {
  let out = String(html ?? '').replace(/\r\n?/g, '\n');
  // Опасные парные теги вместе с содержимым, затем одиночные/незакрытые остатки.
  out = out.replace(/<(script|style|iframe|object|embed)(?![a-z0-9])[^>]*>[^]*?<\/\1\s*>/gi, '');
  out = out.replace(/<\/?(?:script|style|iframe|object|embed)(?![a-z0-9])[^>]*>/gi, '');
  // Атрибуты чистим внутри каждого тега с учётом кавычек (в значении может быть «>»).
  out = out.replace(/<([a-z][^\s>\/]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi, (tag, name: string, rest: string) =>
    cleanTag(tag, name, rest),
  );
  return out;
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
  for (const mark of String(body ?? '').matchAll(/\[\[SERVICE\s+([a-z0-9-]+)\s*\]\]/gi)) {
    if (!result.includes(mark[1])) result.push(mark[1]);
  }
  return result;
}
