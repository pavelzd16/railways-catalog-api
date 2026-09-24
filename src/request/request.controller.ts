import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  UseInterceptors,
  UploadedFiles,
  UseGuards,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RequestService } from './request.service';
import { FindRequestsDto } from './dto/find-requests.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('request')
export class RequestController {
  constructor(private readonly service: RequestService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query() query: FindRequestsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'requestFile', maxCount: 1 },
        { name: 'partnerMapFile', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        // Браузер шлёт имя файла в UTF-8, а multer по умолчанию читает его как latin1:
        // «Смета.pdf» превращалась в «Ð¡Ð¼ÐµÑ‚Ð°.pdf» во вложении письма.
        defParamCharset: 'utf8',
        limits: { fileSize: 10 * 1024 * 1024 },
        fileFilter: (req, file, cb) => {
          const allowedMimeTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ];

          if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(
              new Error('Разрешены только файлы PDF, DOC, DOCX, XLS, XLSX'),
              false,
            );
          }
        },
      },
    ),
  )
  create(
    @Body() dto: CreateRequestDto,
    @UploadedFiles()
    files: {
      requestFile?: Express.Multer.File[];
      partnerMapFile?: Express.Multer.File[];
    },
  ) {
    return this.service.create(
      dto,
      files.requestFile?.[0],
      files.partnerMapFile?.[0],
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.service.delete(id);
  }
}
