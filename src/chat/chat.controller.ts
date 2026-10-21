import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}
  @Post('session')
  create(@Body() body: unknown, @Req() request: Request) {
    return this.chat.createSession(
      body,
      request.ip || request.socket.remoteAddress || 'unknown',
    );
  }
}
