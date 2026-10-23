import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { FileModule } from 'src/file/file.module';
import { NormativController } from './normativ.controller';
import { NormativService } from './normativ.service';

@Module({
  imports: [PrismaModule, FileModule],
  providers: [NormativService],
  controllers: [NormativController],
})
export class NormativModule {}
