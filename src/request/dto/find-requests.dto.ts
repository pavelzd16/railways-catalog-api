import { IsOptional, IsString, IsIn } from 'class-validator';
import { PaginationDto } from 'utils/dto/pagination.dto';

export const REQUEST_TYPE_VALUES = ['service', 'product'] as const;
export type RequestType = (typeof REQUEST_TYPE_VALUES)[number];

export const REQUEST_SORT_VALUES = ['newest', 'oldest'] as const;
export type RequestSort = (typeof REQUEST_SORT_VALUES)[number];

export class FindRequestsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsIn(REQUEST_TYPE_VALUES)
  type?: RequestType;

  @IsOptional()
  @IsIn(REQUEST_SORT_VALUES)
  sort?: RequestSort;
}
