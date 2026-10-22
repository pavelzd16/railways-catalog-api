import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from 'utils/dto/pagination.dto';

// Страница списка статей — 12 штук.
export class FindArticlesDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  override limit?: number = 12;
}
