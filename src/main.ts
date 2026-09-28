import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { AppModule } from './app.module';
import { MulterExceptionFilter } from './common/multer-exception.filter';
import {
  createVariantHandler,
  UPLOADS_MAX_AGE_MS,
} from './file/image-variants';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Раньше статики: иначе готовую копию из uploads/w отдал бы express.static со своими заголовками.
  app.use('/uploads/w', createVariantHandler(join(process.cwd(), 'uploads')));
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
    maxAge: UPLOADS_MAX_AGE_MS,
  });

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'sitemap.xml', method: RequestMethod.GET },
      { path: 'sitemaps/:part.xml', method: RequestMethod.GET },
      { path: 'robots.txt', method: RequestMethod.GET },
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Ошибки загрузки файлов (лишний файл, неверное поле) — 400/413, а не 500.
  app.useGlobalFilters(new MulterExceptionFilter());

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? '*',
    credentials: true,
    exposedHeaders: ['Retry-After'],
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
void bootstrap();
