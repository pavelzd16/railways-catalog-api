import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { escapeXml, getSiteUrl, productPath } from './site-url';

const CHUNK_SIZE = 45000;
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const PUBLIC_PATHS = [
  '/',
  '/catalog',
  '/services',
  '/about',
  '/contacts',
  '/delivery',
  '/calculator',
  '/privacy',
];
type Entry = { path: string; updatedAt?: Date };

function touch(dates: Map<string, Date>, key: string, date: Date) {
  const known = dates.get(key);
  if (!known || date > known) dates.set(key, date);
}

function newest(items: { updatedAt: Date }[]): Date | undefined {
  return items.reduce<Date | undefined>(
    (latest, { updatedAt }) =>
      !latest || updatedAt > latest ? updatedAt : latest,
    undefined,
  );
}

@Injectable()
export class SeoService {
  private readonly origin = getSiteUrl();
  constructor(private readonly prisma: PrismaService) {}

  async sitemap(part?: number): Promise<string> {
    const [products, services, categories] = await Promise.all([
      this.prisma.product.findMany({
        select: {
          slug: true,
          updatedAt: true,
          category: { select: { slug: true } },
          subcategory: { select: { slug: true } },
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.service.findMany({
        select: { slug: true, updatedAt: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.category.findMany({
        select: {
          slug: true,
          // Пустая подкатегория — страница без товаров, в карту её не отдаём.
          subcategories: {
            select: { slug: true },
            where: { products: { some: {} } },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    // Своей даты изменения у разделов и категорий в базе нет: берём самый свежий товар внутри —
    // список на странице меняется вместе с ним. Страницам без своей даты (главная, «О компании»,
    // пустой раздел) ставим дату последнего изменения каталога.
    const categoryUpdatedAt = new Map<string, Date>();
    const subcategoryUpdatedAt = new Map<string, Date>();
    for (const product of products) {
      touch(categoryUpdatedAt, product.category.slug, product.updatedAt);
      if (product.subcategory)
        touch(
          subcategoryUpdatedAt,
          product.subcategory.slug,
          product.updatedAt,
        );
    }
    const siteUpdatedAt = newest([...products, ...services]);
    const servicesUpdatedAt = newest(services) ?? siteUpdatedAt;
    const entries: Entry[] = [
      ...PUBLIC_PATHS.map((path) => ({
        path,
        updatedAt: path === '/services' ? servicesUpdatedAt : siteUpdatedAt,
      })),
      // Порядок параметров совпадает с canonical сайта: category, затем subcategory.
      ...categories.flatMap((category) => [
        {
          path: `/catalog?${new URLSearchParams({ category: category.slug })}`,
          updatedAt: categoryUpdatedAt.get(category.slug) ?? siteUpdatedAt,
        },
        ...category.subcategories.map((subcategory) => ({
          path: `/catalog?${new URLSearchParams({ category: category.slug, subcategory: subcategory.slug })}`,
          updatedAt:
            subcategoryUpdatedAt.get(subcategory.slug) ?? siteUpdatedAt,
        })),
      ]),
      ...products.map((product) => ({
        path: productPath(product),
        updatedAt: product.updatedAt,
      })),
      ...services.map((service) => ({
        path: `/services/${encodeURIComponent(service.slug)}`,
        updatedAt: service.updatedAt,
      })),
    ];
    const prefix = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const count = Math.ceil(entries.length / CHUNK_SIZE);
    if (part === undefined && count > 1) {
      return (
        prefix +
        `<sitemapindex xmlns="${NS}">\n` +
        Array.from(
          { length: count },
          (_, index) =>
            `  <sitemap><loc>${escapeXml(`${this.origin}/sitemaps/${index + 1}.xml`)}</loc></sitemap>`,
        ).join('\n') +
        '\n</sitemapindex>\n'
      );
    }
    if (
      part !== undefined &&
      (!Number.isSafeInteger(part) || part < 1 || part > count)
    )
      throw new NotFoundException('Sitemap not found');
    const selected =
      part === undefined
        ? entries
        : entries.slice((part - 1) * CHUNK_SIZE, part * CHUNK_SIZE);
    return (
      prefix +
      `<urlset xmlns="${NS}">\n` +
      selected
        .map(
          ({ path, updatedAt }) =>
            `  <url><loc>${escapeXml(this.origin + path)}</loc>${updatedAt ? `<lastmod>${updatedAt.toISOString()}</lastmod>` : ''}</url>`,
        )
        .join('\n') +
      '\n</urlset>\n'
    );
  }

  // Clean-param понимает Яндекс: адреса с метками рекламы склеиваются с чистыми. category и subcategory
  // сюда не добавлять — на них держатся страницы каталога.
  robots(): string {
    return [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /cart',
      'Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&from',
      '',
      `Sitemap: ${this.origin}/sitemap.xml`,
      '',
    ].join('\n');
  }
}
