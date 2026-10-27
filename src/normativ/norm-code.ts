// Разбор номеров нормативных документов. Та же логика живёт на сайте
// (railways-catalog/src/entities/normativ/lib/norm-code.ts) — поведение сверяется общими
// примерами test/fixtures/norm-codes.json в обоих репозиториях. Менять — в двух местах сразу.

export type GostPart = { code: string; replacedBy: string | null };

// Латинские буквы, которые на вид не отличить от кириллицы: в русском обозначении
// («ГОСТ P 53866», «ТУ 14-2P-383») их меняем на кириллицу.
const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
};

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** Номер в виде для сравнения: «гост р53866–2010» → «ГОСТ Р 53866-2010». */
export function normalizeCode(code: string): string {
  let result = String(code ?? '')
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (/[А-Я]/.test(result)) {
    result = result.replace(
      /[ABCEHKMOPTX]/g,
      (letter) => LATIN_TO_CYRILLIC[letter],
    );
  }
  return result
    .replace(/ГОСТ ?Р(?= |\d|$)/g, 'ГОСТ Р')
    .replace(/(ГОСТ Р|ГОСТ)(?=\d)/g, '$1 ');
}

/** Адрес страницы документа: «ГОСТ Р 53866-2010» → «gost-r-53866-2010». */
export function codeToSlug(code: string): string {
  return normalizeCode(code)
    .toLowerCase()
    .replace(/[а-яё]/g, (letter) => TRANSLIT[letter])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// «заменён», «заменен», «заменена», «заменены» — окончание любое
const REPLACED_BY = /\(\s*замен[её]н[а-яё]*\s+на\s+([^)]*?)\s*\)/i;

/**
 * Строка поля gost товара → номера документов по порядку. Делит по «;» и «,» вне скобок,
 * «(заменён на …)» выносит в replacedBy. Номера — как написаны, только края обрезаны.
 */
export function parseGostField(gost: string | null | undefined): GostPart[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of String(gost ?? '')) {
    if (char === '(') depth++;
    if (char === ')' && depth > 0) depth--;
    if ((char === ';' || char === ',') && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);

  return parts.flatMap((part) => {
    const replaced = part.match(REPLACED_BY);
    const code = (replaced ? part.replace(REPLACED_BY, ' ') : part)
      .replace(/\s+$/, '')
      .trim();
    if (!code) return [];
    return [{ code, replacedBy: replaced?.[1].trim() || null }];
  });
}

/** Нормализованные номера из строки gost: и сами номера, и их замены. */
function gostCodes(gost: string | null | undefined): string[] {
  return parseGostField(gost).flatMap(({ code, replacedBy }) =>
    replacedBy
      ? [normalizeCode(code), normalizeCode(replacedBy)]
      : [normalizeCode(code)],
  );
}

/** Товары, у которых документ указан в gost — номером или как замена; порядок сохраняется. */
export function matchProductsByCode<T extends { gost?: string | null }>(
  code: string,
  products: T[],
): T[] {
  const wanted = normalizeCode(code);
  if (!wanted) return [];
  return products.filter((product) => gostCodes(product.gost).includes(wanted));
}

/** Документы справочника, на которые ссылается строка gost товара: по порядку в строке, без повторов. */
export function normDocsForGost(
  gost: string | null | undefined,
  docs: { code: string; slug: string }[],
): { code: string; slug: string }[] {
  const byCode = new Map(docs.map((doc) => [normalizeCode(doc.code), doc]));
  const seen = new Set<string>();
  return gostCodes(gost).flatMap((code) => {
    const doc = byCode.get(code);
    if (!doc || seen.has(doc.slug)) return [];
    seen.add(doc.slug);
    return [{ code: doc.code, slug: doc.slug }];
  });
}

/** Естественный порядок номеров: «ГОСТ 977-88» раньше «ГОСТ 4121-96». */
export function compareCodes(a: string, b: string): number {
  return a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' });
}
