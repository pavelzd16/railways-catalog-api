import { Expose, Type } from 'class-transformer';
import { ArticleListItemRdo } from './article.rdo';
import { PaginationRdo } from 'utils/rdo/pagination.rdo';

export class ArticlesRdo {
  @Expose()
  @Type(() => ArticleListItemRdo)
  items!: ArticleListItemRdo[];

  @Expose()
  @Type(() => PaginationRdo)
  pagination!: PaginationRdo;
}
