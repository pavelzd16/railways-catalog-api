import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PrismaModule } from 'prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { NotifyModule } from 'src/notify/notify.module';

@Module({
  imports: [PrismaModule, AuthModule, NotifyModule],
  providers: [OrderService],
  controllers: [OrderController],
})
export class OrderModule {}
