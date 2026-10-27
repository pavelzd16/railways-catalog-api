import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { buildPagination } from 'utils/build-pagination.util';
import { fillDto } from 'utils/fill-dto';
import { FileService } from 'src/file/file.service';
import type { Prisma } from 'generated/prisma/client';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { FindArticlesDto } from './dto/find-articles.dto';
import { ArticleListItemRdo, ArticleRdo } from './rdo/article.rdo';
import { ArticlesRdo } from './rdo/articles.rdo';
import {
  articleServiceSlugs,
  articleSkus,
  cleanArticleHtml,
} from './article-html';

// Повторный адрес: Prisma кидает P2002 (уникальный slug) — отдаём 409 вместо 500.
async function withSlugConflict<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new ConflictException('Статья с таким адресом уже есть');
    }
    throw error;
  }
}

const RELATED_LIMIT = 3;
const WORDS_PER_MINUTE = 180;

type ArticleRow = Prisma.ArticleGetPayload<object>;

export type ArticleProductRow = Prisma.ProductGetPayload<{
  include: { category: true; subcategory: true; specs: true };
}>;

// Карточка товара внутри текста (статьи, выжимки норматива) — поля ArticleProductRdo.
export function mapArticleProduct(p: ArticleProductRow) {
  return {
    id: p.id,
    sku: p.sku,
    slug: p.slug,
    title: p.title,
    price: p.price,
    stock: p.stock,
    condition: p.condition.toLowerCase(),
    images: p.images,
    categorySlug: p.category.slug,
    subcategorySlug: p.subcategory?.slug ?? null,
    categoryName: p.category.name,
    subcategoryName: p.subcategory?.name ?? null,
    specs: p.specs.map((s) => ({
      label: s.label,
      value: s.value,
      unit: s.unit ?? null,
    })),
  };
}

// Время чтения считает только API: слова в тексте без тегов / 180, не меньше минуты.
export function readingMinutes(body: string): number {
  const text = String(body ?? '').replace(/<[^>]*>/g, ' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

@Injectable()
export class ArticleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
  ) {}

  private mapListItem(a: ArticleRow) {
    return {
      id: a.id,
      slug: a.slug,
      title: a.title,
      description: a.description,
      h1: a.h1,
      category: a.category,
      image: a.image,
      publishedAt: a.publishedAt,
      updatedAt: a.updatedAt,
      readingMinutes: readingMinutes(a.body),
      published: a.published,
    };
  }

  private async list(
    where: Prisma.ArticleWhereInput,
    orderBy: Prisma.ArticleOrderByWithRelationInput[],
    query: FindArticlesDto,
  ): Promise<ArticlesRdo> {
    const [articles, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.article.count({ where }),
    ]);

    return fillDto(ArticlesRdo, {
      items: articles.map((a) => this.mapListItem(a)),
      pagination: buildPagination(total, query),
    });
  }

  findPublished(query: FindArticlesDto): Promise<ArticlesRdo> {
    return this.list(
      { published: true },
      [{ publishedAt: 'desc' }, { title: 'asc' }],
      query,
    );
  }

  findAllAdmin(query: FindArticlesDto): Promise<ArticlesRdo> {
    return this.list({}, [{ updatedAt: 'desc' }], query);
  }

  // До 3 опубликованных статей той же рубрики (кроме себя), добор — самыми свежими.
  private async findRelated(article: ArticleRow): Promise<ArticleRow[]> {
    const orderBy: Prisma.ArticleOrderByWithRelationInput[] = [
      { publishedAt: 'desc' },
      { title: 'asc' },
    ];
    const sameCategory = await this.prisma.article.findMany({
      where: {
        published: true,
        category: article.category,
        id: { not: article.id },
      },
      orderBy,
      take: RELATED_LIMIT,
    });
    if (sameCategory.length >= RELATED_LIMIT) return sameCategory;

    const rest = await this.prisma.article.findMany({
      where: {
        published: true,
        id: { notIn: [article.id, ...sameCategory.map((a) => a.id)] },
      },
      orderBy,
      take: RELATED_LIMIT - sameCategory.length,
    });
    return [...sameCategory, ...rest];
  }

  // Живые товары из меток [[CARD …]]: только найденные артикулы, в порядке появления в тексте.
  private async findProducts(body: string) {
    const skus = articleSkus(body);
    if (!skus.length) return [];

    const products = await this.prisma.product.findMany({
      where: { sku: { in: skus } },
      include: { category: true, subcategory: true, specs: true },
    });
    const bySku = new Map(products.map((p) => [p.sku, p]));

    return skus.flatMap((sku) => {
      const p = bySku.get(sku);
      return p ? [mapArticleProduct(p)] : [];
    });
  }

  private async findServices(body: string) {
    const slugs = articleServiceSlugs(body);
    if (!slugs.length) return [];

    const services = await this.prisma.service.findMany({
      where: { slug: { in: slugs } },
    });
    const bySlug = new Map(services.map((s) => [s.slug, s]));

    return slugs.flatMap((slug) => {
      const s = bySlug.get(slug);
      return s
        ? [
            {
              slug: s.slug,
              title: s.title,
              description: s.description,
              image: s.image,
            },
          ]
        : [];
    });
  }

  private async toFull(article: ArticleRow): Promise<ArticleRdo> {
    const [products, services, related] = await Promise.all([
      this.findProducts(article.body),
      this.findServices(article.body),
      this.findRelated(article),
    ]);

    return fillDto(ArticleRdo, {
      ...this.mapListItem(article),
      body: article.body,
      products,
      services,
      related: related.map((a) => this.mapListItem(a)),
    });
  }

  async findOneBySlug(slug: string): Promise<ArticleRdo> {
    const article = await this.prisma.article.findUnique({ where: { slug } });

    if (!article || !article.published) {
      throw new NotFoundException('Article not found');
    }

    return this.toFull(article);
  }

  // Предпросмотр в админке: черновики тоже.
  async findOneById(id: string): Promise<ArticleRdo> {
    const article = await this.prisma.article.findUnique({ where: { id } });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    return this.toFull(article);
  }

  async create(dto: CreateArticleDto): Promise<ArticleListItemRdo> {
    const published = dto.published ?? false;
    let publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : null;
    if (published && !publishedAt) publishedAt = new Date();

    const article = await withSlugConflict(() =>
      this.prisma.article.create({
        data: {
          slug: dto.slug,
          title: dto.title,
          description: dto.description,
          h1: dto.h1,
          category: dto.category,
          body: cleanArticleHtml(dto.body),
          published,
          publishedAt,
        },
      }),
    );

    return fillDto(ArticleListItemRdo, this.mapListItem(article));
  }

  async update(id: string, dto: UpdateArticleDto): Promise<ArticleListItemRdo> {
    const existing = await this.prisma.article.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('Article not found');
    }

    const data: Prisma.ArticleUpdateInput = {};

    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.h1 !== undefined) data.h1 = dto.h1;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.body !== undefined) data.body = cleanArticleHtml(dto.body);
    if (dto.published !== undefined) data.published = dto.published;
    if (dto.publishedAt !== undefined) {
      data.publishedAt = new Date(dto.publishedAt);
    }

    // Статья стала опубликованной, а даты нет — ставим сейчас.
    const published = dto.published ?? existing.published;
    if (published && !(data.publishedAt ?? existing.publishedAt)) {
      data.publishedAt = new Date();
    }

    const article = await withSlugConflict(() =>
      this.prisma.article.update({ where: { id }, data }),
    );

    return fillDto(ArticleListItemRdo, this.mapListItem(article));
  }

  async setImage(
    id: string,
    file: Express.Multer.File,
  ): Promise<ArticleListItemRdo> {
    const existing = await this.prisma.article.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('Article not found');
    }

    const image = await this.fileService.saveFile(file);
    const article = await this.prisma.article.update({
      where: { id },
      data: { image },
    });
    // Старую обложку удаляем после успешной записи новой.
    if (existing.image) {
      await this.fileService.deleteFile(existing.image);
    }

    return fillDto(ArticleListItemRdo, this.mapListItem(article));
  }

  // Картинка внутри текста статьи (схемы): просто сохраняем файл и отдаём путь.
  async uploadImage(file: Express.Multer.File): Promise<{ path: string }> {
    return { path: await this.fileService.saveFile(file) };
  }

  async delete(id: string): Promise<void> {
    const article = await this.prisma.article.findUnique({ where: { id } });

    if (!article) {
      throw new NotFoundException('Article not found');
    }
    if (article.image) {
      await this.fileService.deleteFile(article.image);
    }

    await this.prisma.article.delete({ where: { id } });
  }
}
