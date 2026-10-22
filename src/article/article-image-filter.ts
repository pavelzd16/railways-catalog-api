import { BadRequestException } from '@nestjs/common';

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

// Расширение — тем же правилом, что FileService.saveFile берёт его для имени сохранённого файла.
function fileExtension(originalname: string): string {
  return originalname.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() ?? '';
}

// Фильтр multer для обложки и картинок в тексте статьи: только JPG, PNG, WEBP, GIF.
// Проверяем и тип от клиента, и расширение имени: файл сохраняется с расширением из имени,
// поэтому «image/png» + «x.html» иначе лёг бы на диск как .html.
// Ошибка — BadRequestException: Nest отдаёт её клиенту как 400.
export function articleImageFilter(
  _req: unknown,
  file: { mimetype: string; originalname: string },
  callback: (error: Error | null, accept: boolean) => void,
): void {
  if (
    IMAGE_TYPES.has(file.mimetype) &&
    IMAGE_EXTENSIONS.has(fileExtension(file.originalname ?? ''))
  ) {
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
