import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNotIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  NORM_KINDS,
  NORM_SLUG_PATTERN,
  NORM_STATUSES,
  NORM_WEIGHTS,
  RESERVED_NORM_SLUGS,
} from '../norm-constants';

// Все поля модели, кроме id, файла (file, fileName, fileSize — только через PUT /:id/file) и служебных дат.
export class CreateNormDocumentDto {
  // Не задан — берётся codeToSlug(code).
  @IsOptional()
  @IsString()
  @Matches(NORM_SLUG_PATTERN)
  @IsNotIn(RESERVED_NORM_SLUGS)
  slug?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(NORM_KINDS)
  kind!: string;

  @IsIn(NORM_STATUSES)
  status!: string;

  // null — очистить.
  @IsOptional()
  @IsString()
  replacedBy?: string | null;

  // Дата введения строкой YYYY-MM-DD, без часового пояса.
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  introducedAt?: string | null;

  @IsString()
  @IsNotEmpty()
  scope!: string;

  // slug-и разделов каталога.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(NORM_SLUG_PATTERN, { each: true })
  sections?: string[];

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  sourceUrl?: string | null;

  @IsOptional()
  @IsString()
  sourceName?: string | null;

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
  body!: string;

  @IsIn(NORM_WEIGHTS)
  weight!: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;
}
