import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from 'prisma/prisma.module';
import { NotifyModule } from 'src/notify/notify.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatNotifications } from './chat.notifications';
import { ChatEvents } from './chat.events';
import { ChatAiService } from './ai/chat-ai.service';
import { ChatContextService } from './ai/chat-context.service';
import { GigaChatClient } from './ai/gigachat.client';

@Module({
  imports: [PrismaModule, JwtModule.register({}), NotifyModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatGateway,
    ChatNotifications,
    ChatEvents,
    ChatAiService,
    ChatContextService,
    GigaChatClient,
  ],
})
export class ChatModule {}
