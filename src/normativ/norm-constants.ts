// Списки значений справочника нормативных документов — те же строки на сайте
// (railways-catalog/src/entities/normativ/model/types.ts).
export const NORM_KINDS = [
  'gost',
  'gost-r',
  'ost',
  'sp',
  'tu',
  'rzd',
  'law',
  'order',
  'album',
  'series',
  'other',
] as const;
export type NormKind = (typeof NORM_KINDS)[number];

export const NORM_STATUSES = ['active', 'replaced', 'cancelled'] as const;
export type NormStatus = (typeof NORM_STATUSES)[number];

// Объём выжимки: main — документы на ходовые товары, other — остальные. На сайте не показывается.
export const NORM_WEIGHTS = ['main', 'other'] as const;

// Адреса, которые совпали бы с маршрутами контроллера (admin/list, admin/:id).
export const RESERVED_NORM_SLUGS = ['admin'];

export const NORM_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// PDF документа: ТУ и альбомы бывают большими, но файл целиком ложится в память (memoryStorage).
export const NORM_PDF_MAX_BYTES = 40 * 1024 * 1024;

// «Наши товары по документу» под выжимкой.
export const RELATED_PRODUCTS_LIMIT = 24;
