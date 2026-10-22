// Очистка HTML статьи из админки и разбор меток [[CARD …]] / [[SERVICE …]].

const DANGEROUS_PAIRED = ['script', 'style', 'iframe', 'object', 'embed'];

export function cleanArticleHtml(html: string): string {
  let out = String(html ?? '').replace(/\r\n?/g, '\n');
  for (const tag of DANGEROUS_PAIRED) {
    // Парный тег вместе с содержимым, затем одиночные/незакрытые остатки.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[^]*?</${tag}\\s*>`, 'gi'), '');
    out = out.replace(new RegExp(`</?${tag}\\b[^>]*>`, 'gi'), '');
  }
  // Атрибуты on*="…" / on*='…' / on*=значение
  out = out.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // href/src с javascript: и data: (кроме data:image/)
  out = out.replace(
    /(\s(?:href|src)\s*=\s*)(?:"\s*([^"]*)"|'\s*([^']*)'|([^\s>]+))/gi,
    (match, prefix: string, dq?: string, sq?: string, bare?: string) => {
      const value = (dq ?? sq ?? bare ?? '').replace(/[\u0000- ]+/g, '').toLowerCase();
      if (value.startsWith('javascript:')) return '';
      if (value.startsWith('data:') && !value.startsWith('data:image/')) return '';
      return match;
    },
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
