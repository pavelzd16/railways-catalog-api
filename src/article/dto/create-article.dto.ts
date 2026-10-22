import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNotIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

// Адреса, которые совпали бы с маршрутами контроллера (admin/..., upload).
export const RESERVED_ARTICLE_SLUGS = ['admin', 'upload'];

export class CreateArticleDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @IsNotIn(RESERVED_ARTICLE_SLUGS)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  h1!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;
}
