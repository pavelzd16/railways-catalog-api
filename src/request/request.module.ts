import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { FileModule } from 'src/file/file.module';
import { NotifyModule } from 'src/notify/notify.module';
import { RequestService } from './request.service';
import { RequestController } from './request.controller';

@Module({
  imports: [PrismaModule, FileModule, NotifyModule],
  providers: [RequestService],
  controllers: [RequestController],
})
export class RequestModule {}
