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
import { ChatEvents } from './chat.events';
import type { ChatActor } from './chat.service';
import type { IncomingMessage } from 'node:http';

const originLogger = new Logger('ChatGateway:Origin');

export function chatOriginAllowed(origin?: string): boolean {
  if (!origin) {
    originLogger.debug('Подключение без Origin (не браузерный клиент) — разрешено');
    return true; // Non-browser clients still have to authenticate.
  }
  const configured = [
    process.env.SITE_URL,
    ...(process.env.CORS_ORIGIN || '').split(','),
  ]
    .filter(Boolean)
    .map((value) => value!.replace(/\/$/, ''));
  const allowed = configured.includes(origin);
  if (allowed) {
    originLogger.debug(`Origin разрешён: ${origin}`);
  } else {
    originLogger.warn(
      `Origin отклонён: ${origin}. Разрешённые: [${configured.join(', ')}]`,
    );
  }
  return allowed;
}

@WebSocketGateway({
  path: '/api/chat/socket.io',
  transports: ['websocket'],
  maxHttpBufferSize: 16384,
  // allowRequest: (
  //   request: IncomingMessage,
  //   callback: (error: string | null, success: boolean) => void,
  // ) => callback(null, chatOriginAllowed(request.headers.origin)),
})
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  constructor(
    private readonly chat: ChatService,
    private readonly events: ChatEvents,
  ) {}

  afterInit(server: Server) {
    this.events.server = server;
    this.logger.log(
      'Chat gateway инициализирован (path: /api/chat/socket.io, transport: websocket)',
    );

    server.use((socket, next) => {
      const ip = socket.handshake.address;
      const origin = socket.handshake.headers.origin ?? 'нет';
      this.logger.debug(
        `Попытка подключения: socket=${socket.id} ip=${ip} origin=${origin}`,
      );

      this.chat
        .authenticate(socket.handshake.auth)
        .then(async (actor) => {
          (socket.data as { actor: ChatActor }).actor = actor;
          const room = actor.role === 'MANAGER' ? 'managers' : `chat:${actor.id}`;
          await socket.join(room);
          this.logger.log(
            `Клиент подключён: socket=${socket.id} role=${actor.role} id=${actor.id} room=${room} ip=${ip} ` +
              `истекает=${new Date(actor.expiresAt).toISOString()} ` +
              `всего_подключений=${this.server?.engine?.clientsCount ?? 'n/a'}`,
          );

          const expiry = setInterval(() => {
            if (actor.expiresAt <= Date.now()) {
              this.logger.warn(
                `Сессия истекла, отключаем: socket=${socket.id} role=${actor.role} id=${actor.id}`,
              );
              socket.emit('chat:expired');
              socket.disconnect(true);
            }
          }, 60000);
          expiry.unref();

          socket.once('disconnect', (reason) => {
            clearInterval(expiry);
            this.logger.log(
              `Клиент отключён: socket=${socket.id} role=${actor.role} id=${actor.id} причина=${reason}`,
            );
          });
          socket.on('error', (err) => {
            this.logger.error(
              `Ошибка сокета: socket=${socket.id} role=${actor.role} id=${actor.id} — ${err?.message ?? err}`,
            );
          });
          next();
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Аутентификация не удалась: socket=${socket.id} ip=${ip} origin=${origin} — ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          next(
            Object.assign(
              new Error('Сессия чата недействительна. Войдите заново.'),
              { data: { code: 'UNAUTHORIZED' } },
            ),
          );
        });
    });
  }

  private async handle(
    socket: Socket,
    event: string,
    action: (actor: ChatActor) => Promise<unknown>,
  ) {
    const startedAt = Date.now();
    const actor = (socket.data as { actor?: ChatActor }).actor;
    const who = actor
      ? `role=${actor.role} id=${actor.id}`
      : 'actor=неизвестен';
    try {
      if (!actor) throw new Error('Actor отсутствует в socket.data');
      this.logger.debug(`→ ${event} socket=${socket.id} ${who}`);
      this.chat.limiter.check(`event:${actor.role}:${actor.id}`, 300, 60000);
      const data = await action(actor);
      this.logger.debug(
        `✓ ${event} socket=${socket.id} ${who} (${Date.now() - startedAt} мс)`,
      );
      return { ok: true, data };
    } catch (error) {
      const duration = Date.now() - startedAt;
      if (error instanceof HttpException) {
        this.logger.warn(
          `✗ ${event} socket=${socket.id} ${who} status=${error.getStatus()} ` +
            `"${error.message}" (${duration} мс)`,
        );
      } else {
        this.logger.error(
          `✗ ${event} socket=${socket.id} ${who} — непредвиденная ошибка (${duration} мс)`,
          error instanceof Error ? error.stack : String(error),
        );
      }
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
    return this.handle(socket, 'chat:list', (actor) =>
      this.chat.list(actor, data),
    );
  }

  @SubscribeMessage('chat:history')
  history(@ConnectedSocket() socket: Socket, @MessageBody() data: unknown) {
    return this.handle(socket, 'chat:history', (actor) =>
      this.chat.history(actor, data),
    );
  }

  @SubscribeMessage('chat:send')
  send(@ConnectedSocket() socket: Socket, @MessageBody() data: unknown) {
    return this.handle(socket, 'chat:send', async (actor) => {
      const result = await this.chat.send(actor, data);
      if (result.created) {
        this.logger.log(
          `Новое сообщение: conversation=${result.message.conversationId} ` +
            `от role=${actor.role} id=${actor.id}`,
        );
        this.server
          .to('managers')
          .to(`chat:${result.message.conversationId}`)
          .emit('chat:message', result.message);
        this.logger.debug(
          `Разослано chat:message → managers, chat:${result.message.conversationId}`,
        );
        this.logger.debug(
          `Запуск publishAi: conversation=${result.message.conversationId}`,
        );
        await this.chat.publishAi(result.message.conversationId);
      } else {
        this.logger.debug(
          `Сообщение не создано (дубликат?): conversation=${result.message.conversationId} ` +
            `role=${actor.role} id=${actor.id}`,
        );
      }
      return result.message;
    });
  }

  @SubscribeMessage('chat:read')
  read(@ConnectedSocket() socket: Socket, @MessageBody() data: unknown) {
    return this.handle(socket, 'chat:read', async (actor) => {
      const result = await this.chat.read(actor, data);
      this.server
        .to('managers')
        .to(`chat:${result.conversationId}`)
        .emit('chat:read', result);
      this.logger.debug(
        `Разослано chat:read: conversation=${result.conversationId} ` +
          `role=${actor.role} id=${actor.id}`,
      );
      return result;
    });
  }

  @SubscribeMessage('chat:close')
  close(@ConnectedSocket() socket: Socket, @MessageBody() data: unknown) {
    return this.handle(socket, 'chat:close', async (actor) => {
      const result = await this.chat.close(actor, data);
      this.logger.log(
        `Диалог закрыт: conversation=${result.id} role=${actor.role} id=${actor.id}`,
      );
      await this.chat.publishAi(result.id);
      this.server
        .to('managers')
        .to(`chat:${result.id}`)
        .emit('chat:closed', result);
      this.logger.debug(`Разослано chat:closed: conversation=${result.id}`);
      return result;
    });
  }

  @SubscribeMessage('chat:ai:mode')
  aiMode(@ConnectedSocket() socket: Socket, @MessageBody() data: unknown) {
    return this.handle(socket, 'chat:ai:mode', async (actor) => {
      const result = await this.chat.aiMode(actor, data);
      this.logger.log(
        `Смена режима AI: role=${actor.role} id=${actor.id} data=${JSON.stringify(data)}`,
      );
      return result;
    });
  }

  @SubscribeMessage('chat:ai:cancel')
  aiCancel(@ConnectedSocket() socket: Socket, @MessageBody() data: unknown) {
    return this.handle(socket, 'chat:ai:cancel', async (actor) => {
      const result = await this.chat.aiCancel(actor, data);
      this.logger.log(
        `Отмена AI: role=${actor.role} id=${actor.id} data=${JSON.stringify(data)}`,
      );
      return result;
    });
  }
}