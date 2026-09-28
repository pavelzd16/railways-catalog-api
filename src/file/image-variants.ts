import { promises as fs } from 'fs';
import { join } from 'path';
import type { NextFunction, Request, Response } from 'express';
import sharp from 'sharp';

// Уменьшенные копии картинок из uploads в WebP: /uploads/w/<ширина>/<файл>.webp.
// Оригинал не трогаем; копия делается при первом запросе и лежит в uploads/w/<ширина>/.
// Ширины — только из списка, иначе любой мог бы забить диск копиями произвольных размеров.
export const VARIANT_WIDTHS = [160, 320, 480, 640, 960, 1280] as const;

// Качество 88: на выборке из 32 фото сайта SSIM не ниже 0,98 (медиана 0,999) против
// уменьшенного оригинала без сжатия, а размер в 4–10 раз меньше исходного JPEG.
export const WEBP_QUALITY = 88;

// Имена файлов — как у FileService (uuid.расширение), только растровые форматы.
const SOURCE_NAME = /^[a-z0-9][a-z0-9._-]*\.(?:jpe?g|png|webp)$/i;

// Имена не меняются (FileService даёт каждому файлу новый uuid), поэтому браузер может
// долго держать и оригинал, и копию. Месяц — с запасом на случай ручной замены файла.
export const UPLOADS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_CONTROL = `public, max-age=${UPLOADS_MAX_AGE_MS / 1000}`;

export interface VariantRequest {
  width: number;
  source: string;
}

// path — остаток адреса после /uploads/w, например «/480/abc.jpg.webp».
export function parseVariantPath(path: string): VariantRequest | null {
  const match = /^\/(\d+)\/([^/]+)\.webp$/.exec(path);
  if (!match) return null;
  const width = Number(match[1]);
  const source = match[2];
  if (!(VARIANT_WIDTHS as readonly number[]).includes(width)) return null;
  if (!SOURCE_NAME.test(source)) return null;
  return { width, source };
}

export function variantFilePath(
  uploadDir: string,
  width: number,
  source: string,
): string {
  return join(uploadDir, 'w', String(width), `${source}.webp`);
}

export async function renderVariant(
  input: string | Buffer,
  width: number,
): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 4, smartSubsample: true })
    .toBuffer();
}

async function fileMtime(path: string): Promise<number | null> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile() ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}

async function writeAtomically(path: string, data: Buffer): Promise<void> {
  await fs.mkdir(join(path, '..'), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, data);
  await fs.rename(temp, path);
}

// Сервер слабый (2 ядра), поэтому копии считаются по одной за раз, а одинаковые
// одновременные запросы ждут одну и ту же работу.
sharp.concurrency(1);
sharp.cache(false);
const MAX_PARALLEL = 2;
let running = 0;
const waiting: Array<() => void> = [];
const inFlight = new Map<string, Promise<Buffer>>();

async function withSlot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL)
    await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export function createVariantHandler(uploadDir: string) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const parsed = parseVariantPath(req.path);
    if (!parsed) {
      res.status(404).end();
      return;
    }
    const { width, source } = parsed;
    const sourcePath = join(uploadDir, source);
    const targetPath = variantFilePath(uploadDir, width, source);

    const sourceMtime = await fileMtime(sourcePath);
    if (sourceMtime === null) {
      // Оригинал удалён (например, заменили картинку в карточке) — копию тоже не показываем.
      await fs.unlink(targetPath).catch(() => undefined);
      res.status(404).end();
      return;
    }

    const targetMtime = await fileMtime(targetPath);
    if (targetMtime !== null && targetMtime >= sourceMtime) {
      res.sendFile(targetPath, {
        maxAge: UPLOADS_MAX_AGE_MS,
        headers: { 'Content-Type': 'image/webp' },
      });
      return;
    }

    let job = inFlight.get(targetPath);
    if (!job) {
      job = withSlot(async () => {
        const data = await renderVariant(sourcePath, width);
        await writeAtomically(targetPath, data);
        return data;
      }).finally(() => inFlight.delete(targetPath));
      inFlight.set(targetPath, job);
    }

    try {
      const data = await job;
      res.set({ 'Content-Type': 'image/webp', 'Cache-Control': CACHE_CONTROL });
      res.send(data);
    } catch {
      // Файл не читается как картинка — отдаём оригинал, сайт покажет его как раньше.
      res.redirect(302, `/uploads/${source}`);
    }
  };
}

// Для FileService.deleteFile: вместе с оригиналом убрать и все его копии.
export function variantPathsFor(uploadDir: string, fileName: string): string[] {
  return VARIANT_WIDTHS.map((width) =>
    variantFilePath(uploadDir, width, fileName),
  );
}
