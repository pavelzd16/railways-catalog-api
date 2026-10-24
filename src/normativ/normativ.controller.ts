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
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { NormativService } from './normativ.service';
import { CreateNormDocumentDto } from './dto/create-norm-document.dto';
import { UpdateNormDocumentDto } from './dto/update-norm-document.dto';
import { NormFileDto } from './dto/norm-file.dto';
import {
  NormPreviewsAppendDto,
  NormPreviewsDto,
} from './dto/norm-previews.dto';
import {
  NORM_PDF_MAX_BYTES,
  NORM_PREVIEW_MAX_BYTES,
  NORM_PREVIEW_MAX_FILES,
} from './norm-constants';
import { normPdfFilter } from './norm-pdf';
import { normPreviewFilter } from './norm-preview';

// PDF — отдельным multipart-запросом, текст документа идёт JSON-ом (в multipart переводы строк портятся).
// Больше лимита — 413 (MulterExceptionFilter), не PDF — 400. Имена файлов — в UTF-8 (русские названия).
const pdfInterceptor = () =>
  FileInterceptor('file', {
    storage: memoryStorage(),
    defParamCharset: 'utf8',
    limits: { fileSize: NORM_PDF_MAX_BYTES, files: 1 },
    fileFilter: normPdfFilter,
  });

// Картинки страниц: поле images, пачка до 20 файлов по 2 МБ; 21-й файл — 400, больше 2 МБ — 413.
const previewsInterceptor = () =>
  FilesInterceptor('images', NORM_PREVIEW_MAX_FILES, {
    storage: memoryStorage(),
    limits: { fileSize: NORM_PREVIEW_MAX_BYTES, files: NORM_PREVIEW_MAX_FILES },
    fileFilter: normPreviewFilter,
  });

@Controller('normativ')
export class NormativController {
  constructor(private readonly normativService: NormativService) {}

  @Get()
  findPublished() {
    return this.normativService.findPublished();
  }

  // Маршруты admin/... объявлены до :slug.
  @Get('admin/list')
  @UseGuards(JwtAuthGuard)
  findAllAdmin() {
    return this.normativService.findAllAdmin();
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard)
  findOneAdmin(@Param('id') id: string) {
    return this.normativService.findOneById(id);
  }

  @Get(':slug')
  findOneBySlug(@Param('slug') slug: string) {
    return this.normativService.findOneBySlug(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateNormDocumentDto) {
    return this.normativService.create(dto);
  }

  @Put(':id/file')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(pdfInterceptor())
  setFile(
    @Param('id') id: string,
    @Body() form: NormFileDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Файл file не передан');
    return this.normativService.setFile(id, file, form.fileName);
  }

  @Put(':id/previews')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(previewsInterceptor())
  setPreviews(
    @Param('id') id: string,
    @Body() form: NormPreviewsDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    if (!files?.length)
      throw new BadRequestException('Картинки images не переданы');
    return this.normativService.setPreviews(id, files, form.pageCount);
  }

  // Следующая пачка картинок страниц — дописывается в конец (первую пачку шлёт PUT, он заменяет все).
  @Post(':id/previews')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(previewsInterceptor())
  appendPreviews(
    @Param('id') id: string,
    @Body() form: NormPreviewsAppendDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    if (!files?.length)
      throw new BadRequestException('Картинки images не переданы');
    return this.normativService.appendPreviews(id, files, form.pageCount);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  update(@Param('id') id: string, @Body() dto: UpdateNormDocumentDto) {
    return this.normativService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.normativService.delete(id);
  }
}
