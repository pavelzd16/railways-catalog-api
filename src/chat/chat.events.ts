import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Keeps the durable AI worker independent of gateway lifecycle. */
@Injectable()
export class ChatEvents {
  server?: Server;

  managers(event: string, payload: unknown) {
    this.server?.to('managers').emit(event, payload);
  }

  message(message: { conversationId: string }) {
    this.server
      ?.to('managers')
      .to(`chat:${message.conversationId}`)
      .emit('chat:message', message);
  }
}
