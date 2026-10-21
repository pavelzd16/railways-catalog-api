import { HttpException, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import type { ChatActor } from './chat.service';
import type { IncomingMessage } from 'node:http';

export function chatOriginAllowed(origin?: string): boolean {
  if (!origin) return true; // Non-browser clients still have to authenticate.
  const configured = [
    process.env.SITE_URL,
    ...(process.env.CORS_ORIGIN || '').split(','),
  ]
    .filter(Boolean)
    .map((value) => value!.replace(/\/$/, ''));
  return configured.includes(origin);
}

@WebSocketGateway({
  path: '/api/chat/socket.io',
  transports: ['websocket'],
  maxHttpBufferSize: 16384,
  allowRequest: (
    request: IncomingMessage,
    callback: (error: string | null, success: boolean) => void,
  ) => callback(null, chatOriginAllowed(request.headers.origin)),
})
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  constructor(private readonly chat: ChatService) {}
  afterInit(server: Server) {
    server.use((socket, next) => {
      this.chat
        .authenticate(socket.handshake.auth)
        .then(async (actor) => {
          (socket.data as { actor: ChatActor }).actor = actor;
          await socket.join(
            actor.role === 'MANAGER' ? 'managers' : `chat:${actor.id}`,
          );
          const expiry = setInterval(() => {
            if (actor.expiresAt <= Date.now()) {
              socket.emit('chat:expired');
              socket.disconnect(true);
            }
          }, 60000);
          expiry.unref();
          socket.once('disconnect', () => clearInterval(expiry));
          next();
        })
        .catch(() =>
          next(
            Object.assign(
              new Error('Сессия чата недействительна. Войдите заново.'),
              { data: { code: 'UNAUTHORIZED' } },
            ),
          ),
        );
    });
  }

  private async handle(
    socket: Socket,
    action: (actor: ChatActor) => Promise<unknown>,
  ) {
    try {
      const actor = (socket.data as { actor: ChatActor }).actor;
      this.chat.limiter.check(`event:${actor.role}:${actor.id}`, 300, 60000);
      return { ok: true, data: await action(actor) };
    } catch (error) {
      if (!(error instanceof HttpException))
        this.logger.error(
          'Chat operation failed',
          error instanceof Error ? error.stack : undefined,
        );
      return {
        ok: false,
        error:
          error instanceof HttpException
            ? error.message
            : 'Не удалось выполнить действие. Попробуйте ещё раз.',
        code: error instanceof HttpException ? error.getStatus() : 500,
      };
    }
  }

  @SubscribeMessage('chat:list')
  list(@ConnectedSocket() socket: Socket, @MessageBody() data: unknown) {
    return this.handle(socket, (actor) => this.chat.list(actor, data));
  }
  @SubscribeMessage('chat:history')
  history(@ConnectedSocket() socket: Socket, @MessageBody() data: unknown) {
    return this.handle(socket, (actor) => this.chat.history(actor, data));
  }
  @SubscribeMessage('chat:send')
  send(@ConnectedSocket() socket: Socket, @MessageBody() data: unknown) {
    return this.handle(socket, async (actor) => {
      const result = await this.chat.send(actor, data);
      if (result.created)
        this.server
          .to('managers')
          .to(`chat:${result.message.conversationId}`)
          .emit('chat:message', result.message);
      return result.message;
    });
  }
  @SubscribeMessage('chat:read')
  read(@ConnectedSocket() socket: Socket, @MessageBody() data: unknown) {
    return this.handle(socket, async (actor) => {
      const result = await this.chat.read(actor, data);
      this.server
        .to('managers')
        .to(`chat:${result.conversationId}`)
        .emit('chat:read', result);
      return result;
    });
  }
  @SubscribeMessage('chat:close')
  close(@ConnectedSocket() socket: Socket, @MessageBody() data: unknown) {
    return this.handle(socket, async (actor) => {
      const result = await this.chat.close(actor, data);
      this.server
        .to('managers')
        .to(`chat:${result.id}`)
        .emit('chat:closed', result);
      return result;
    });
  }
}
