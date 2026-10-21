import { Module } from '@nestjs/common';
import { FileModule } from './file/file.module';
import { ProductCategoryModule } from './product-category/product-category.module';
import { ProductSubcategoryModule } from './product-subcategory/product-subcategory.module';
import { ProductModule } from './product/product.module';
import { RequestModule } from './request/request.module';
import { ServiceModule } from './service/service.module';
import { OrderModule } from './order/order.module';
import { StatsModule } from './stats/stats.module';
import { AuthModule } from './auth/auth.module';
import { SeoModule } from './seo/seo.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ProductModule,
    ProductCategoryModule,
    ProductSubcategoryModule,
    FileModule,
    ServiceModule,
    RequestModule,
    OrderModule,
    StatsModule,
    AuthModule,
    SeoModule,
    ChatModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
