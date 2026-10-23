import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { fillDto } from 'utils/fill-dto';
import { FileService } from 'src/file/file.service';
import type { Prisma } from 'generated/prisma/client';
import {
  articleServiceSlugs,
  articleSkus,
  cleanArticleHtml,
} from 'src/article/article-html';
import {
  ArticleProductRow,
  mapArticleProduct,
} from 'src/article/article.service';
import { CreateNormDocumentDto } from './dto/create-norm-document.dto';
import { UpdateNormDocumentDto } from './dto/update-norm-document.dto';
import {
  NormAdminListItemRdo,
  NormAdminListRdo,
  NormDocumentFullRdo,
  NormListRdo,
} from './rdo/norm-document.rdo';
import {
  codeToSlug,
  compareCodes,
  matchProductsByCode,
  normalizeCode,
} from './norm-code';
import {
  NORM_SLUG_PATTERN,
  RELATED_PRODUCTS_LIMIT,
  RESERVED_NORM_SLUGS,
} from './norm-constants';
import { isPdfContent, pdfDownloadName } from './norm-pdf';

type NormRow = Prisma.NormDocumentGetPayload<object>;

const NOT_FOUND = 'Документ не найден';
const CONFLICT = 'Документ с таким адресом или номером уже есть';
const PRODUCT_INCLUDE = { category: true, subcategory: true, specs: true };

// Повтор slug или code: Prisma кидает P2002 — отдаём 409 вместо 500.
async function withConflict<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new ConflictException(CONFLICT);
    }
    throw error;
  }
}

// Самая длинная группа цифр номера: «ТУ 14-2Р-383-2004» → «2004». Цифры нормализация не меняет,
// поэтому выборка «gost содержит эти цифры» не теряет ни одного подходящего товара.
function digitKey(code: string): string | null {
  let longest: string | null = null;
  for (const run of code.match(/\d+/g) ?? []) {
    if (!longest || run.length > longest.length) longest = run;
  }
  return longest;
}

@Injectable()
export class NormativService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
  ) {}

  private mapListItem(d: NormRow) {
    return {
      slug: d.slug,
      code: d.code,
      name: d.name,
      kind: d.kind,
      status: d.status,
      replacedBy: d.replacedBy,
      introducedAt: d.introducedAt,
      scope: d.scope,
      sections: d.sections ?? [],
      hasFile: !!d.file,
      updatedAt: d.updatedAt,
    };
  }

  private mapAdminItem(d: NormRow) {
    return {
      ...this.mapListItem(d),
      id: d.id,
      weight: d.weight,
      published: d.published,
      publishedAt: d.publishedAt,
      file: d.file,
      fileName: d.fileName,
      fileSize: d.fileSize,
      createdAt: d.createdAt,
    };
  }

  private toAdminItem(d: NormRow): NormAdminListItemRdo {
    return fillDto(NormAdminListItemRdo, this.mapAdminItem(d));
  }

  private sortByCode(docs: NormRow[]): NormRow[] {
    return [...docs].sort((a, b) => compareCodes(a.code, b.code));
  }

  async findPublished(): Promise<NormListRdo> {
    const docs = await this.prisma.normDocument.findMany({
      where: { published: true },
    });
    return fillDto(NormListRdo, {
      items: this.sortByCode(docs).map((d) => this.mapListItem(d)),
    });
  }

  async findAllAdmin(): Promise<NormAdminListRdo> {
    const docs = await this.prisma.normDocument.findMany({});
    return fillDto(NormAdminListRdo, {
      items: this.sortByCode(docs).map((d) => this.mapAdminItem(d)),
    });
  }

  private toNormProduct(p: ArticleProductRow) {
    return { ...mapArticleProduct(p), gost: p.gost ?? null };
  }

  // Живые товары из меток [[CARD …]]: только найденные, в порядке появления в тексте.
  private async findProducts(body: string): Promise<ArticleProductRow[]> {
    const skus = articleSkus(body);
    if (!skus.length) return [];
    const products = await this.prisma.product.findMany({
      where: { sku: { in: skus } },
      include: PRODUCT_INCLUDE,
    });
    const bySku = new Map(products.map((p) => [p.sku, p]));
    return skus.flatMap((sku) => bySku.get(sku) ?? []);
  }

  // Все товары, у которых документ указан в gost (номером или как замена), кроме уже показанных.
  private async findRelatedProducts(
    code: string,
    excludeIds: Set<string>,
  ): Promise<ArticleProductRow[]> {
    const key = digitKey(code);
    const candidates = await this.prisma.product.findMany({
      where: key
        ? { gost: { contains: key, mode: 'insensitive' } }
        : { gost: { not: null } },
      include: PRODUCT_INCLUDE,
      orderBy: [{ title: 'asc' }, { sku: 'asc' }],
    });
    return matchProductsByCode(code, candidates)
      .filter((p) => !excludeIds.has(p.id))
      .slice(0, RELATED_PRODUCTS_LIMIT);
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

  // Документ-замена из справочника: только опубликованный (иначе ссылка вела бы на 404).
  private async findReplacedByDoc(
    d: NormRow,
  ): Promise<{ slug: string; code: string } | null> {
    if (!d.replacedBy) return null;
    const wanted = normalizeCode(d.replacedBy);
    const published = await this.prisma.normDocument.findMany({
      where: { published: true },
      select: { id: true, slug: true, code: true },
    });
    const found = published.find(
      (other) => other.id !== d.id && normalizeCode(other.code) === wanted,
    );
    return found ? { slug: found.slug, code: found.code } : null;
  }

  private async toFull(d: NormRow): Promise<NormDocumentFullRdo> {
    const [products, services, replacedByDoc] = await Promise.all([
      this.findProducts(d.body),
      this.findServices(d.body),
      this.findReplacedByDoc(d),
    ]);
    const relatedProducts = await this.findRelatedProducts(
      d.code,
      new Set(products.map((p) => p.id)),
    );

    return fillDto(NormDocumentFullRdo, {
      ...this.mapAdminItem(d),
      sourceUrl: d.sourceUrl,
      sourceName: d.sourceName,
      title: d.title,
      description: d.description,
      h1: d.h1,
      body: d.body,
      products: products.map((p) => this.toNormProduct(p)),
      relatedProducts: relatedProducts.map((p) => this.toNormProduct(p)),
      services,
      replacedByDoc,
    });
  }

  async findOneBySlug(slug: string): Promise<NormDocumentFullRdo> {
    const d = await this.prisma.normDocument.findUnique({ where: { slug } });
    if (!d || !d.published) throw new NotFoundException(NOT_FOUND);
    return this.toFull(d);
  }

  // Предпросмотр: черновики тоже.
  async findOneById(id: string): Promise<NormDocumentFullRdo> {
    return this.toFull(await this.getById(id));
  }

  private async getById(id: string): Promise<NormRow> {
    const d = await this.prisma.normDocument.findUnique({ where: { id } });
    if (!d) throw new NotFoundException(NOT_FOUND);
    return d;
  }

  // Уникальность code в базе — по написанию; «ГОСТ 4121–96» и «ГОСТ 4121-96» — тоже повтор.
  private async assertCodeFree(code: string, exceptId?: string) {
    const wanted = normalizeCode(code);
    const docs = await this.prisma.normDocument.findMany({
      select: { id: true, code: true },
    });
    if (
      docs.some((d) => d.id !== exceptId && normalizeCode(d.code) === wanted)
    ) {
      throw new ConflictException(CONFLICT);
    }
  }

  async create(dto: CreateNormDocumentDto): Promise<NormAdminListItemRdo> {
    const slug = dto.slug ?? codeToSlug(dto.code);
    if (!NORM_SLUG_PATTERN.test(slug) || RESERVED_NORM_SLUGS.includes(slug)) {
      throw new BadRequestException(
        'Из номера не получается адрес — задайте slug',
      );
    }
    await this.assertCodeFree(dto.code);

    const published = dto.published ?? false;
    let publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : null;
    if (published && !publishedAt) publishedAt = new Date();

    const d = await withConflict(() =>
      this.prisma.normDocument.create({
        data: {
          slug,
          code: dto.code.trim(),
          name: dto.name,
          kind: dto.kind,
          status: dto.status,
          replacedBy: dto.replacedBy || null,
          introducedAt: dto.introducedAt || null,
          scope: dto.scope,
          sections: dto.sections ?? [],
          sourceUrl: dto.sourceUrl || null,
          sourceName: dto.sourceName || null,
          title: dto.title,
          description: dto.description,
          h1: dto.h1,
          body: cleanArticleHtml(dto.body),
          weight: dto.weight,
          published,
          publishedAt,
        },
      }),
    );
    return this.toAdminItem(d);
  }

  async update(
    id: string,
    dto: UpdateNormDocumentDto,
  ): Promise<NormAdminListItemRdo> {
    const existing = await this.getById(id);
    if (dto.code !== undefined) await this.assertCodeFree(dto.code, id);

    const data: Prisma.NormDocumentUpdateInput = {};
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.code !== undefined) data.code = dto.code.trim();
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.replacedBy !== undefined) data.replacedBy = dto.replacedBy || null;
    if (dto.introducedAt !== undefined) {
      data.introducedAt = dto.introducedAt || null;
    }
    if (dto.scope !== undefined) data.scope = dto.scope;
    if (dto.sections !== undefined) data.sections = dto.sections;
    if (dto.sourceUrl !== undefined) data.sourceUrl = dto.sourceUrl || null;
    if (dto.sourceName !== undefined) data.sourceName = dto.sourceName || null;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.h1 !== undefined) data.h1 = dto.h1;
    if (dto.body !== undefined) data.body = cleanArticleHtml(dto.body);
    if (dto.weight !== undefined) data.weight = dto.weight;
    if (dto.published !== undefined) data.published = dto.published;
    if (dto.publishedAt !== undefined) {
      data.publishedAt = new Date(dto.publishedAt);
    }

    // Документ стал опубликованным, а даты нет — ставим сейчас.
    const published = dto.published ?? existing.published;
    if (published && !(data.publishedAt ?? existing.publishedAt)) {
      data.publishedAt = new Date();
    }

    const d = await withConflict(() =>
      this.prisma.normDocument.update({ where: { id }, data }),
    );
    return this.toAdminItem(d);
  }

  // PDF документа: новый файл пишется, запись обновляется, прежний файл удаляется.
  async setFile(
    id: string,
    file: Express.Multer.File,
    fileName?: string,
  ): Promise<NormAdminListItemRdo> {
    if (!isPdfContent(file.buffer)) {
      throw new BadRequestException('Файл не похож на PDF');
    }
    const existing = await this.getById(id);

    const path = await this.fileService.saveFile(file);
    let d: NormRow;
    try {
      d = await this.prisma.normDocument.update({
        where: { id },
        data: {
          file: path,
          fileName: pdfDownloadName(
            fileName || file.originalname,
            existing.code,
          ),
          fileSize: file.size,
        },
      });
    } catch (error) {
      await this.fileService.deleteFile(path);
      throw error;
    }
    if (existing.file && existing.file !== path) {
      await this.fileService.deleteFile(existing.file);
    }
    return this.toAdminItem(d);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    await this.prisma.normDocument.delete({ where: { id } });
    if (existing.file) await this.fileService.deleteFile(existing.file);
  }
}
