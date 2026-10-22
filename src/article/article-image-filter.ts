import { BadRequestException } from '@nestjs/common';

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// Фильтр multer для обложки и картинок в тексте статьи: только JPG, PNG, WEBP, GIF.
// Ошибка — BadRequestException: Nest отдаёт её клиенту как 400.
export function articleImageFilter(
  _req: unknown,
  file: { mimetype: string },
  callback: (error: Error | null, accept: boolean) => void,
): void {
  if (IMAGE_TYPES.has(file.mimetype)) {
    callback(null, true);
    return;
  }
  callback(
    new BadRequestException(
      'Можно загрузить только картинку (JPG, PNG, WEBP, GIF)',
    ),
    false,
  );
}
