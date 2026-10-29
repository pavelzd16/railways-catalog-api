import { Expose, Type } from 'class-transformer';
import { ProductSpecRdo } from './product-spec.rdo';
import { CategoryRdo } from 'src/product-category/rdo/category.rdo';
import { SubcategoryRdo } from 'src/product-subcategory/rdo/subcategory.rdo';

export class ProductRdo {
  @Expose()
  id!: string;

  @Expose()
  sku!: string;

  @Expose()
  title!: string;

  @Expose()
  slug!: string;

  @Expose()
  gost!: string;

  @Expose()
  price!: number;

  @Expose()
  priceOnRequest?: boolean;

  @Expose()
  stock!: number;

  @Expose()
  condition!: 'new' | 'used' | 'service';

  @Expose()
  images!: string[];

  @Expose()
  video?: string | null;

  @Expose()
  categorySlug!: string;

  @Expose()
  subcategorySlug?: string;

  @Expose()
  category?: CategoryRdo;

  @Expose()
  subcategory?: SubcategoryRdo;

  @Expose()
  description?: string;

  @Expose()
  descriptionTags?: string | null;

  @Expose()
  @Type(() => ProductSpecRdo)
  specs?: ProductSpecRdo[];

  @Expose()
  analogues?: string[];
}
