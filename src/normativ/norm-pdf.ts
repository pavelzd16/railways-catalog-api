import { BadRequestException } from '@nestjs/common';

export const PDF_ONLY_MESSAGE = 'Можно загрузить только PDF';

// Фильтр multer для файла документа: и тип от клиента, и расширение имени —
// файл сохраняется с расширением из имени, поэтому «application/pdf» + «x.html» лёг бы на диск как .html.
// Ошибка — BadRequestException: Nest отдаёт её клиенту как 400.
export function normPdfFilter(
  _req: unknown,
  file: { mimetype: string; originalname: string },
  callback: (error: Error | null, accept: boolean) => void,
): void {
  if (
    file.mimetype === 'application/pdf' &&
    /\.pdf$/i.test(file.originalname ?? '')
  ) {
    callback(null, true);
    return;
  }
  callback(new BadRequestException(PDF_ONLY_MESSAGE), false);
}

// Содержимое тоже проверяем: настоящий PDF начинается с «%PDF-».
export function isPdfContent(buffer: Buffer | undefined): boolean {
  return !!buffer && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

const MAX_NAME_LENGTH = 150;

function cleanName(value: string): string {
  return (
    value
      .replace(/^.*[\\/]/, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.pdf$/i, '')
      .replace(/[.\s]+$/, '')
      .slice(0, MAX_NAME_LENGTH - 4)
      .trim()
  );
}

// Читаемое имя для «Скачать PDF»: без папок, служебных знаков и управляющих символов,
// всегда с «.pdf»; пустое — по номеру документа.
export function pdfDownloadName(
  raw: string | null | undefined,
  code: string,
): string {
  const base =
    cleanName(String(raw ?? '')) ||
    cleanName(String(code ?? '').replace(/[\\/]/g, ' ')) ||
    'document';
  return `${base}.pdf`;
}
