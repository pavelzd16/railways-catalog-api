import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  IsIn,
  Min,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  parseJsonFormArrayOf,
  parseJsonFormField,
} from 'src/common/json-form-field';

export const VIDEO_PATH = /^\/uploads\/[a-z0-9][a-z0-9._-]*\.(mp4|webm)$/i;

export class CreateProductSpecDto {
  @IsString()
  label!: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const num = Number(value);
    return !isNaN(num) && String(value).trim() !== '' ? num : value;
  })
  value!: number | string;
}

export class CreateProductDto {
  @IsString()
  sku!: string;

  @IsString()
  title!: string;

  @IsString()
  slug!: string;

  @IsOptional()
  @IsString()
  gost?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === 'null' || value === null ? null : Number(value),
  )
  @IsNumber()
  @Min(0)
  price?: number | null;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  stock!: number;

  @IsIn(['new', 'used', 'service'])
  condition!: 'new' | 'used' | 'service';

  @IsString()
  categorySlug!: string;

  @IsOptional()
  @IsString()
  subcategorySlug?: string;

  // Пустая строка или null убирают ролик.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === '' || value === 'null' ? null : value,
  )
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(VIDEO_PATH)
  video?: string | null;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  descriptionTags?: string;

  @Transform(({ value }: { value: unknown }) =>
    parseJsonFormArrayOf(CreateProductSpecDto, value),
  )
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductSpecDto)
  specs?: CreateProductSpecDto[];

  @Transform(({ value }: { value: unknown }) => parseJsonFormField(value))
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  analogues?: string[];
}
