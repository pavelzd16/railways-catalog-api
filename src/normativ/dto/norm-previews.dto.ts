import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { NORM_PAGE_COUNT_MAX } from '../norm-constants';

// Поля формы рядом с картинками в PUT /api/normativ/:id/previews (первая пачка, заменяет все прежние).
export class NormPreviewsDto {
  // Сколько страниц в PDF — для подписи «Стр. N из M» и «N страниц · PDF · M МБ».
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NORM_PAGE_COUNT_MAX)
  pageCount!: number;
}

// Поля формы в POST /api/normativ/:id/previews (следующая пачка, дописывается в конец): число страниц — по желанию.
export class NormPreviewsAppendDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NORM_PAGE_COUNT_MAX)
  pageCount?: number;
}
