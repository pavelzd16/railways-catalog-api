import { Expose, Type } from 'class-transformer';

export class ArticleListItemRdo {
  @Expose()
  id!: string;

  @Expose()
  slug!: string;

  @Expose()
  title!: string;

  @Expose()
  description!: string;

  @Expose()
  h1!: string;

  @Expose()
  category!: string;

  @Expose()
  image?: string | null;

  @Expose()
  publishedAt?: Date | null;

  @Expose()
  updatedAt!: Date;

  @Expose()
  readingMinutes!: number;

  // В публичном списке всегда true; в админском отличает черновики.
  @Expose()
  published!: boolean;
}

export class ArticleSpecRdo {
  @Expose()
  label!: string;

  @Expose()
  value!: string;

  @Expose()
  unit?: string | null;
}

export class ArticleProductRdo {
  @Expose()
  id!: string;

  @Expose()
  sku!: string;

  @Expose()
  slug!: string;

  @Expose()
  title!: string;

  @Expose()
  price?: number | null;

  @Expose()
  stock!: number;

  @Expose()
  condition!: string;

  @Expose()
  images!: string[];

  @Expose()
  categorySlug!: string;

  @Expose()
  subcategorySlug?: string | null;

  @Expose()
  categoryName!: string;

  @Expose()
  subcategoryName?: string | null;

  @Expose()
  @Type(() => ArticleSpecRdo)
  specs!: ArticleSpecRdo[];
}

export class ArticleServiceRdo {
  @Expose()
  slug!: string;

  @Expose()
  title!: string;

  @Expose()
  description!: string;

  @Expose()
  image?: string | null;
}

export class ArticleRdo extends ArticleListItemRdo {
  @Expose()
  body!: string;

  @Expose()
  @Type(() => ArticleProductRdo)
  products!: ArticleProductRdo[];

  @Expose()
  @Type(() => ArticleServiceRdo)
  services!: ArticleServiceRdo[];

  @Expose()
  @Type(() => ArticleListItemRdo)
  related!: ArticleListItemRdo[];
}
