import { IsOptional, IsString, MaxLength } from 'class-validator';

// Поля формы рядом с файлом в PUT /api/normativ/:id/file.
export class NormFileDto {
  // Имя для «Скачать PDF»; не задано — исходное имя файла.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fileName?: string;
}
