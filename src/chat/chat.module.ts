import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from 'prisma/prisma.module';
import { NotifyModule } from 'src/notify/notify.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatNotifications } from './chat.notifications';

@Module({
  imports: [PrismaModule, JwtModule.register({}), NotifyModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatNotifications],
})
export class ChatModule {}
