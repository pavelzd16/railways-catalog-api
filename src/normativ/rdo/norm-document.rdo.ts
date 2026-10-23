import { Expose, Type } from 'class-transformer';
import {
  ArticleProductRdo,
  ArticleServiceRdo,
} from 'src/article/rdo/article.rdo';

// Строка публичного списка /api/normativ (без текста выжимки).
export class NormListItemRdo {
  @Expose()
  slug!: string;

  @Expose()
  code!: string;

  @Expose()
  name!: string;

  @Expose()
  kind!: string;

  @Expose()
  status!: string;

  @Expose()
  replacedBy!: string | null;

  @Expose()
  introducedAt!: string | null;

  @Expose()
  scope!: string;

  @Expose()
  sections!: string[];

  @Expose()
  hasFile!: boolean;

  // Число страниц PDF; null — не известно (картинки страниц ещё не загружены).
  @Expose()
  pageCount!: number | null;

  @Expose()
  updatedAt!: Date;
}

export class NormListRdo {
  @Expose()
  @Type(() => NormListItemRdo)
  items!: NormListItemRdo[];
}

// Строка админского списка и ответ на запись: плюс id, черновик/публикация и файл.
export class NormAdminListItemRdo extends NormListItemRdo {
  @Expose()
  id!: string;

  @Expose()
  weight!: string;

  @Expose()
  published!: boolean;

  @Expose()
  publishedAt!: Date | null;

  @Expose()
  file!: string | null;

  @Expose()
  fileName!: string | null;

  @Expose()
  fileSize!: number | null;

  // Картинки первых страниц PDF по порядку: /uploads/<uuid>.<ext>.
  @Expose()
  previews!: string[];

  @Expose()
  createdAt!: Date;
}

export class NormAdminListRdo {
  @Expose()
  @Type(() => NormAdminListItemRdo)
  items!: NormAdminListItemRdo[];
}

// Карточка товара на странице документа — как у статей, плюс ГОСТ.
export class NormProductRdo extends ArticleProductRdo {
  @Expose()
  gost!: string | null;
}

export class NormLinkRdo {
  @Expose()
  slug!: string;

  @Expose()
  code!: string;
}

export class NormDocumentFullRdo extends NormAdminListItemRdo {
  @Expose()
  sourceUrl!: string | null;

  @Expose()
  sourceName!: string | null;

  @Expose()
  title!: string;

  @Expose()
  description!: string;

  @Expose()
  h1!: string;

  @Expose()
  body!: string;

  // Товары из меток [[CARD …]] выжимки, в порядке появления.
  @Expose()
  @Type(() => NormProductRdo)
  products!: NormProductRdo[];

  // Все наши товары, у которых документ указан в gost (кроме уже показанных в products), до 24.
  @Expose()
  @Type(() => NormProductRdo)
  relatedProducts!: NormProductRdo[];

  @Expose()
  @Type(() => ArticleServiceRdo)
  services!: ArticleServiceRdo[];

  // Документ-замена, если он есть в справочнике и опубликован.
  @Expose()
  @Type(() => NormLinkRdo)
  replacedByDoc!: NormLinkRdo | null;
}
