import { Expose, Type } from 'class-transformer';
import { ProductRdo } from './product.rdo';

// Документ справочника /normativ, на который ссылается поле gost товара.
export class ProductNormDocRdo {
  @Expose()
  code!: string;

  @Expose()
  slug!: string;
}

// Ответ GET /api/product/:slug: товар плюс ссылки на документы справочника.
export class ProductDetailRdo extends ProductRdo {
  @Expose()
  @Type(() => ProductNormDocRdo)
  normDocs!: ProductNormDocRdo[];
}
