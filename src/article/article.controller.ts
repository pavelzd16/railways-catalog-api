import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { ArticleService } from './article.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { FindArticlesDto } from './dto/find-articles.dto';

// Картинки принимаем только отдельными multipart-запросами: текст статьи идёт JSON-ом
// (в multipart переводы строк превращаются в CRLF).
const imageInterceptor = () =>
  FileInterceptor('image', {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  });

@Controller('article')
export class ArticleController {
  constructor(private readonly articleService: ArticleService) {}

  @Get()
  findPublished(@Query() query: FindArticlesDto) {
    return this.articleService.findPublished(query);
  }

  // Маршруты admin/... и upload объявлены до :slug.
  @Get('admin/list')
  @UseGuards(JwtAuthGuard)
  findAllAdmin(@Query() query: FindArticlesDto) {
    return this.articleService.findAllAdmin(query);
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard)
  findOneAdmin(@Param('id') id: string) {
    return this.articleService.findOneById(id);
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(imageInterceptor())
  upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл image не передан');
    return this.articleService.uploadImage(file);
  }

  @Get(':slug')
  findOneBySlug(@Param('slug') slug: string) {
    return this.articleService.findOneBySlug(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateArticleDto) {
    return this.articleService.create(dto);
  }

  @Put(':id/image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(imageInterceptor())
  setImage(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Файл image не передан');
    return this.articleService.setImage(id, file);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  update(@Param('id') id: string, @Body() dto: UpdateArticleDto) {
    return this.articleService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.articleService.delete(id);
  }
}
