import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { FileModule } from 'src/file/file.module';
import { ArticleController } from './article.controller';
import { ArticleService } from './article.service';

@Module({
  imports: [PrismaModule, FileModule],
  providers: [ArticleService],
  controllers: [ArticleController],
})
export class ArticleModule {}
