import { BadRequestException } from '@nestjs/common';

export const PREVIEW_ONLY_MESSAGE =
  'Можно загрузить только картинки страниц (JPG, PNG, WEBP)';

const PREVIEW_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PREVIEW_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

// Расширение — тем же правилом, что FileService.saveFile берёт его для имени сохранённого файла.
function fileExtension(originalname: string): string {
  return originalname.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() ?? '';
}

// Фильтр multer для картинок страниц документа: и тип от клиента, и расширение имени
// (файл ложится на диск с расширением из имени). GIF не берём — у него нет WebP-копий.
// Ошибка — BadRequestException: Nest отдаёт её клиенту как 400.
export function normPreviewFilter(
  _req: unknown,
  file: { mimetype: string; originalname: string },
  callback: (error: Error | null, accept: boolean) => void,
): void {
  if (
    PREVIEW_TYPES.has(file.mimetype) &&
    PREVIEW_EXTENSIONS.has(fileExtension(file.originalname ?? ''))
  ) {
    callback(null, true);
    return;
  }
  callback(new BadRequestException(PREVIEW_ONLY_MESSAGE), false);
}

// Содержимое тоже проверяем по сигнатуре: JPEG «FF D8 FF», PNG «89 50 4E 47 0D 0A 1A 0A», WEBP «RIFF….WEBP».
export function isPreviewImageContent(buffer: Buffer | undefined): boolean {
  if (!buffer || buffer.length < 3) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return true;
  }
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  );
}
