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
  NORM_PAGE_COUNT_MAX,
  NORM_PREVIEW_MAX_FILES,
  NORM_PREVIEWS_MAX,
  NORM_SLUG_PATTERN,
  RELATED_PRODUCTS_LIMIT,
  RESERVED_NORM_SLUGS,
} from './norm-constants';
import { isPdfContent, pdfDownloadName } from './norm-pdf';
import { isPreviewImageContent } from './norm-preview';

type NormRow = Prisma.NormDocumentGetPayload<object>;

const NOT_FOUND = 'Документ не найден';
const CONFLICT = 'Документ с таким адресом или номером уже есть';
const PRODUCT_INCLUDE = { category: true, subcategory: true, specs: true };
const PREVIEWS_LOCK_PREFIX = 'normativ-document:';

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
      pageCount: d.pageCount ?? null,
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
      previews: d.previews ?? [],
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

  // Какие опубликованные документы заменил этот: их replacedBy указывает на его номер.
  private async findReplaces(
    d: NormRow,
  ): Promise<{ code: string; slug: string }[]> {
    const mine = normalizeCode(d.code);
    const published = await this.prisma.normDocument.findMany({
      where: { published: true },
      select: { id: true, slug: true, code: true, replacedBy: true },
    });
    return published
      .filter(
        (other) =>
          other.id !== d.id &&
          !!other.replacedBy &&
          normalizeCode(other.replacedBy) === mine,
      )
      .sort((a, b) => compareCodes(a.code, b.code))
      .map((other) => ({ code: other.code, slug: other.slug }));
  }

  private async toFull(d: NormRow): Promise<NormDocumentFullRdo> {
    const [products, services, replacedByDoc, replaces] = await Promise.all([
      this.findProducts(d.body),
      this.findServices(d.body),
      this.findReplacedByDoc(d),
      this.findReplaces(d),
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
      replaces,
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

  private async deleteFiles(paths: string[]): Promise<void> {
    await Promise.all(paths.map((path) => this.fileService.deleteFile(path)));
  }

  // Пачка картинок страниц: от 1 до NORM_PREVIEW_MAX_FILES, по содержимому — JPEG, PNG или WEBP.
  private checkPreviewBatch(files: Express.Multer.File[]): void {
    if (!files.length || files.length > NORM_PREVIEW_MAX_FILES) {
      throw new BadRequestException(
        `Картинок страниц в одной пачке — от 1 до ${NORM_PREVIEW_MAX_FILES}`,
      );
    }
    if (!files.every((file) => isPreviewImageContent(file.buffer))) {
      throw new BadRequestException(
        'Файл не похож на картинку JPG, PNG или WEBP',
      );
    }
  }

  private checkPageCount(pageCount: number): void {
    if (
      !Number.isInteger(pageCount) ||
      pageCount < 1 ||
      pageCount > NORM_PAGE_COUNT_MAX
    ) {
      throw new BadRequestException('Число страниц — целое, от 1');
    }
  }

  private checkPreviewLimit(count: number, adding: number): void {
    if (count + adding > NORM_PREVIEWS_MAX) {
      throw new BadRequestException(
        `Картинок страниц у документа — не больше ${NORM_PREVIEWS_MAX} (уже ${count})`,
      );
    }
  }

  // Замок на документ до конца транзакции (общий для всех процессов): загрузки картинок страниц
  // и удаление документа идут по очереди, список previews читается заново уже под замком.
  private withDocumentLock<T>(
    id: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${PREVIEWS_LOCK_PREFIX + id}, 0))`;
        return action(tx);
      },
      { timeout: 15_000 },
    );
  }

  // Сохраняет файлы пачки и под замком пишет previews (и pageCount, если передано): append — в конец
  // текущего списка с проверкой предела, replace — вместо него. При любом отказе новые файлы удаляются.
  // Возвращает запись и картинки, выпавшие из списка (их файлы удаляет вызывающий после записи).
  private async savePreviews(
    id: string,
    files: Express.Multer.File[],
    mode: 'append' | 'replace',
    pageCount?: number,
  ): Promise<{ d: NormRow; stale: string[] }> {
    const saved: string[] = [];
    try {
      for (const file of files)
        saved.push(await this.fileService.saveFile(file));
      return await this.withDocumentLock(id, async (tx) => {
        const current = await tx.normDocument.findUnique({ where: { id } });
        if (!current) throw new NotFoundException(NOT_FOUND);
        const before = current.previews ?? [];
        if (mode === 'append')
          this.checkPreviewLimit(before.length, saved.length);
        const d = await tx.normDocument.update({
          where: { id },
          data: {
            previews: mode === 'append' ? [...before, ...saved] : saved,
            ...(pageCount === undefined ? {} : { pageCount }),
          },
        });
        const stale =
          mode === 'append' ? [] : before.filter((p) => !saved.includes(p));
        return { d, stale };
      });
    } catch (error) {
      await this.deleteFiles(saved);
      throw error;
    }
  }

  // Картинки страниц PDF, первая пачка: заменяет прежние целиком (старые файлы удаляются), пишет число страниц.
  // Картинки уже нужного размера (~1400 px WebP) — сайт берёт оригинал, уменьшенные копии /uploads/w/… не заводятся.
  async setPreviews(
    id: string,
    files: Express.Multer.File[],
    pageCount: number,
  ): Promise<NormAdminListItemRdo> {
    this.checkPreviewBatch(files);
    this.checkPageCount(pageCount);
    await this.getById(id);
    const { d, stale } = await this.savePreviews(
      id,
      files,
      'replace',
      pageCount,
    );
    await this.deleteFiles(stale);
    return this.toAdminItem(d);
  }

  // Следующая пачка картинок страниц: дописывается в конец; у документа — не больше NORM_PREVIEWS_MAX картинок.
  // Первая проверка предела — до сохранения файлов (быстрый отказ), окончательная — под замком.
  async appendPreviews(
    id: string,
    files: Express.Multer.File[],
    pageCount?: number,
  ): Promise<NormAdminListItemRdo> {
    this.checkPreviewBatch(files);
    if (pageCount !== undefined) this.checkPageCount(pageCount);
    const existing = await this.getById(id);
    this.checkPreviewLimit((existing.previews ?? []).length, files.length);
    const { d } = await this.savePreviews(id, files, 'append', pageCount);
    return this.toAdminItem(d);
  }

  // Документ снова без файла («по запросу»): PDF и картинки страниц снимаются с диска, поля файла обнуляются.
  // Нужен для отката обновления, которое добавило файл (zalit-normativ.mjs --otkat). Под тем же замком, что картинки.
  async removeFile(id: string): Promise<NormDocumentFullRdo> {
    const { d, existing } = await this.withDocumentLock(id, async (tx) => {
      const current = await tx.normDocument.findUnique({ where: { id } });
      if (!current) throw new NotFoundException(NOT_FOUND);
      const updated = await tx.normDocument.update({
        where: { id },
        data: {
          file: null,
          fileName: null,
          fileSize: null,
          previews: [],
          pageCount: null,
        },
      });
      return { d: updated, existing: current };
    });
    if (existing.file) await this.fileService.deleteFile(existing.file);
    await this.deleteFiles(existing.previews ?? []);
    return this.toFull(d);
  }

  // Под тем же замком, что загрузка картинок: пачка, записанная до удаления, попадёт в список и будет удалена,
  // а записанная после — получит 404 и удалит свои файлы сама.
  async delete(id: string): Promise<void> {
    const existing = await this.withDocumentLock(id, async (tx) => {
      const d = await tx.normDocument.findUnique({ where: { id } });
      if (!d) throw new NotFoundException(NOT_FOUND);
      await tx.normDocument.delete({ where: { id } });
      return d;
    });
    if (existing.file) await this.fileService.deleteFile(existing.file);
    await this.deleteFiles(existing.previews ?? []);
  }
}
