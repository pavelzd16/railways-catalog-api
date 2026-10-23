import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { NORM_PAGE_COUNT_MAX } from '../norm-constants';

// Поля формы рядом с картинками в PUT /api/normativ/:id/previews.
export class NormPreviewsDto {
  // Сколько страниц в PDF — для подписи «N страниц · PDF · M МБ».
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NORM_PAGE_COUNT_MAX)
  pageCount!: number;
}
