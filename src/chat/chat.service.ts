import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { ChatAiService, aiSelect } from './ai/chat-ai.service';
import { PrismaService } from 'prisma/prisma.service';
import {
  ChatLimiter,
  positiveInt,
  record,
  text,
  uuid,
} from './chat-validation';

export type ChatActor = {
  role: 'VISITOR' | 'MANAGER';
  id: string;
  expiresAt: number;
};
const messageSelect = {
  id: true,
  conversationId: true,
  clientId: true,
  sender: true,
  body: true,
  createdAt: true,
  readAt: true,
} as const;
const conversationSelect = {
  id: true,
  visitorName: true,
  contact: true,
  pageUrl: true,
  closed: true,
  createdAt: true,
  updatedAt: true,
} as const;
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  readonly limiter = new ChatLimiter();
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly ai: ChatAiService,
  ) {}

  async createSession(input: unknown, ip: string) {
    this.logger.debug(`createSession: запрос ip=${ip}`);
    try {
      this.limiter.check(`session:${ip}`, 10, 3600000);
    } catch (error) {
      this.logger.warn(`createSession: превышен лимит сессий ip=${ip}`);
      throw error;
    }
    const data = record(input);
    if (data.policyAccepted !== true) {
      this.logger.warn(`createSession: нет согласия на обработку данных ip=${ip}`);
      throw new ForbiddenException('Нужно согласие на обработку данных');
    }
    const visitorName = text(data.name, 80);
    const contact = text(data.contact, 160, false);
    const page = text(data.pageUrl, 1000, false);
    const pageUrl =
      page.startsWith('/') &&
      !page.startsWith('//') &&
      ![...page].some(
        (character) =>
          character === '\\' ||
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127,
      )
        ? page.split(/[?#]/)[0]
        : undefined;
    if (page && !pageUrl) {
      this.logger.debug(
        `createSession: pageUrl отброшен как небезопасный ip=${ip}`,
      );
    }
    const token = randomBytes(32).toString('hex');
    const conversation = await this.prisma.chatConversation.create({
      data: {
        tokenHash: hash(token),
        visitorName,
        contact: contact || null,
        pageUrl,
        policyAcceptedAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 86400000),
      },
      select: conversationSelect,
    });
    this.logger.log(
      `createSession: создана переписка conversation=${conversation.id} ip=${ip} pageUrl=${pageUrl ?? 'нет'} контакт=${contact ? 'указан' : 'нет'}`,
    );
    return { conversation, token };
  }

  async authenticate(input: unknown): Promise<ChatActor> {
    const auth = record(input);
    if (auth.adminToken) {
      this.logger.debug('authenticate: попытка входа менеджера по JWT');
      try {
        if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
        const payload = await this.jwt.verifyAsync<{
          sub: string;
          exp: number;
        }>(text(auth.adminToken, 4096), { secret: process.env.JWT_SECRET });
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
        });
        if (!user || user.role !== 'admin') {
          throw new Error(
            user
              ? `пользователь ${user.id} не является admin`
              : `пользователь ${payload.sub} не найден`,
          );
        }
        this.logger.log(`authenticate: менеджер авторизован user=${user.id}`);
        return {
          role: 'MANAGER',
          id: user.id,
          expiresAt: payload.exp
            ? payload.exp * 1000
            : Date.now() + 12 * 3600000,
        };
      } catch (error) {
        this.logger.warn(
          `authenticate: отказ менеджеру — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw new UnauthorizedException('Войдите в админку заново');
      }
    }
    this.logger.debug('authenticate: попытка входа посетителя по токену');
    const token = text(auth.token, 64);
    if (!/^[0-9a-f]{64}$/.test(token)) {
      this.logger.warn('authenticate: отказ посетителю — неверный формат токена');
      throw new UnauthorizedException('Сессия чата недействительна');
    }
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { tokenHash: hash(token) },
    });
    if (!conversation) {
      this.logger.warn('authenticate: отказ посетителю — переписка по токену не найдена');
      throw new UnauthorizedException('Сессия чата истекла');
    }
    if (conversation.expiresAt.getTime() <= Date.now()) {
      this.logger.warn(
        `authenticate: отказ посетителю — сессия истекла conversation=${conversation.id}`,
      );
      throw new UnauthorizedException('Сессия чата истекла');
    }
    this.logger.log(
      `authenticate: посетитель авторизован conversation=${conversation.id}`,
    );
    return {
      role: 'VISITOR',
      id: conversation.id,
      expiresAt: conversation.expiresAt.getTime(),
    };
  }

  authorize(actor: ChatActor, conversationId?: unknown) {
    if (!actor || actor.expiresAt <= Date.now()) {
      this.logger.warn(
        `authorize: сессия истекла role=${actor?.role ?? 'нет'} id=${actor?.id ?? 'нет'}`,
      );
      throw new UnauthorizedException('Сессия истекла. Войдите заново.');
    }
    if (conversationId !== undefined) {
      const id = uuid(conversationId);
      if (actor.role !== 'MANAGER' && actor.id !== id) {
        this.logger.warn(
          `authorize: доступ запрещён role=${actor.role} id=${actor.id} запросил conversation=${id}`,
        );
        throw new ForbiddenException('Нет доступа к переписке');
      }
      return id;
    }
    if (actor.role !== 'MANAGER') {
      this.logger.warn(
        `authorize: доступ запрещён role=${actor.role} id=${actor.id} — только для менеджеров`,
      );
      throw new ForbiddenException('Нет доступа');
    }
    return '';
  }

  async list(actor: ChatActor, input: unknown) {
    this.authorize(actor);
    const data = record(input);
    const page =
      data.page === undefined ? 1 : Math.min(positiveInt(data.page), 10000);
    const search = text(data.search, 100, false);
    this.logger.debug(
      `list: manager=${actor.id} page=${page} поиск=${search ? `"${search}"` : 'нет'}`,
    );
    const where = {
      messages: { some: {} },
      ...(search
        ? {
            OR: [
              {
                visitorName: { contains: search, mode: 'insensitive' as const },
              },
              { contact: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.chatConversation.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 30,
        take: 30,
        select: {
          ...conversationSelect,
          ...aiSelect,
          messages: { orderBy: { id: 'desc' }, take: 1, select: messageSelect },
          _count: {
            select: {
              messages: { where: { sender: 'VISITOR', readAt: null } },
            },
          },
        },
      }),
      this.prisma.chatConversation.count({ where }),
    ]);
    this.logger.debug(
      `list: manager=${actor.id} найдено=${total} возвращено=${items.length} page=${page}`,
    );
    return {
      items: items.map(
        ({ _count, messages, aiEnabled, aiRevision, aiDraft, ...item }) => ({
          ...item,
          ai: this.ai.state({ aiEnabled, aiRevision, aiDraft }),
          unread: _count.messages,
          lastMessage: messages[0],
        }),
      ),
      total,
      page,
    };
  }

  async history(actor: ChatActor, input: unknown) {
    const data = record(input);
    const id = this.authorize(actor, data.conversationId);
    const before =
      data.before === undefined ? undefined : positiveInt(data.before);
    this.logger.debug(
      `history: role=${actor.role} id=${actor.id} conversation=${id} before=${before ?? 'нет'}`,
    );
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { id },
      select: { ...conversationSelect, ...aiSelect },
    });
    if (!conversation) {
      this.logger.warn(`history: переписка не найдена conversation=${id}`);
      throw new NotFoundException('Переписка не найдена');
    }
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId: id, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: 51,
      select: messageSelect,
    });
    this.logger.debug(
      `history: conversation=${id} загружено=${Math.min(messages.length, 50)} есть_ещё=${messages.length > 50}`,
    );
    const { aiEnabled, aiRevision, aiDraft, ...publicConversation } =
      conversation;
    return {
      conversation: {
        ...publicConversation,
        ...(actor.role === 'MANAGER'
          ? { ai: this.ai.state({ aiEnabled, aiRevision, aiDraft }) }
          : {}),
      },
      hasMore: messages.length > 50,
      messages: messages.slice(0, 50).reverse(),
    };
  }

  async send(actor: ChatActor, input: unknown) {
    const data = record(input);
    const conversationId = this.authorize(actor, data.conversationId);
    const clientId = uuid(data.clientId);
    const body = text(data.body, 4000);
    this.logger.debug(
      `send: role=${actor.role} id=${actor.id} conversation=${conversationId} clientId=${clientId} длина=${body.length}`,
    );
    const key = {
      conversationId_sender_clientId: {
        conversationId,
        sender: actor.role,
        clientId,
      },
    };
    const existing = await this.prisma.chatMessage.findUnique({
      where: key,
      select: messageSelect,
    });
    if (existing) {
      this.logger.debug(
        `send: дубликат clientId=${clientId} conversation=${conversationId} message=${existing.id}`,
      );
      return { message: existing, created: false };
    }
    try {
      this.limiter.check(
        `send:${actor.role}:${actor.id}`,
        actor.role === 'MANAGER' ? 120 : 30,
        60000,
      );
    } catch (error) {
      this.logger.warn(
        `send: превышен лимит сообщений role=${actor.role} id=${actor.id}`,
      );
      throw error;
    }
    try {
      const { message, wantsHuman } = await this.prisma.$transaction(
        async (tx) => {
          const wantsHuman =
            actor.role === 'MANAGER' ||
            /(?:(?:позови(?:те)?|соедини(?:те)?|переключи(?:те)?|свяжи(?:те)?|нужен)\s+(?:с\s+)?(?:жив(?:ого|ым)\s+)?|(?:хочу|можно)\s+(?:поговорить|пообщаться)\s+с\s+(?:живым\s+)?)(?:менеджер|оператор|человек)/i.test(
              body,
            );
          const conversation = await tx.chatConversation.update({
            where: { id: conversationId },
            data: {
              updatedAt: new Date(),
              closed: false,
              aiRevision: { increment: 1 },
              ...(wantsHuman ? { aiEnabled: false } : {}),
            },
          });
          const result = await tx.chatMessage.create({
            data: {
              conversationId,
              clientId,
              sender: actor.role,
              body,
              notificationDueAt: actor.role === 'VISITOR' ? new Date() : null,
            },
            select: messageSelect,
          });
          if (actor.role === 'VISITOR')
            await this.ai.enqueue(tx, conversation, result.id);
          else await this.ai.cancel(tx, conversationId);
          return { message: result, wantsHuman };
        },
      );
      this.logger.log(
        `send: сообщение создано message=${message.id} conversation=${conversationId} sender=${actor.role} ` +
          `ИИ_${actor.role === 'VISITOR' ? 'поставлен_в_очередь' : 'отменён'}` +
          (wantsHuman && actor.role === 'VISITOR'
            ? ' (посетитель запросил человека, ИИ выключен)'
            : ''),
      );
      return { message, created: true };
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') {
        this.logger.error(
          `send: ошибка сохранения conversation=${conversationId} clientId=${clientId}`,
          error instanceof Error ? error.stack : String(error),
        );
        throw error;
      }
      this.logger.warn(
        `send: гонка дубликата (P2002) conversation=${conversationId} clientId=${clientId}`,
      );
      const message = await this.prisma.chatMessage.findUniqueOrThrow({
        where: key,
        select: messageSelect,
      });
      return { message, created: false };
    }
  }

  async read(actor: ChatActor, input: unknown) {
    const data = record(input);
    const conversationId = this.authorize(actor, data.conversationId);
    const through = positiveInt(data.through);
    const readAt = new Date();
    const { count } = await this.prisma.chatMessage.updateMany({
      where: {
        conversationId,
        id: { lte: through },
        sender:
          actor.role === 'MANAGER' ? 'VISITOR' : { in: ['MANAGER', 'AI'] },
        readAt: null,
      },
      data: { readAt },
    });
    this.logger.debug(
      `read: reader=${actor.role} id=${actor.id} conversation=${conversationId} through=${through} помечено=${count}`,
    );
    return { conversationId, through, reader: actor.role, readAt };
  }

  async close(actor: ChatActor, input: unknown) {
    this.authorize(actor);
    const data = record(input);
    const id = uuid(data.conversationId);
    this.logger.debug(`close: manager=${actor.id} conversation=${id}`);
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.chatConversation.update({
        where: { id },
        data: { closed: true, aiEnabled: false, aiRevision: { increment: 1 } },
        select: conversationSelect,
      });
      await this.ai.cancel(tx, id);
      return updated;
    });
    this.logger.log(
      `close: переписка закрыта conversation=${id} manager=${actor.id}, ИИ выключен`,
    );
    return result;
  }

  async aiMode(actor: ChatActor, input: unknown) {
    this.authorize(actor);
    const data = record(input);
    if (typeof data.enabled !== 'boolean') {
      this.logger.warn(`aiMode: не указан режим manager=${actor.id}`);
      throw new ForbiddenException('Укажите режим ИИ');
    }
    const id = uuid(data.conversationId);
    this.logger.log(
      `aiMode: manager=${actor.id} conversation=${id} enabled=${data.enabled}`,
    );
    return this.ai.mode(id, data.enabled);
  }

  async aiCancel(actor: ChatActor, input: unknown) {
    this.authorize(actor);
    const data = record(input);
    const id = uuid(data.conversationId);
    const draftId = uuid(data.draftId);
    this.logger.log(
      `aiCancel: manager=${actor.id} conversation=${id} draft=${draftId}`,
    );
    return this.ai.mode(id, false, draftId);
  }

  publishAi(conversationId: string) {
    this.logger.debug(`publishAi: conversation=${conversationId}`);
    return this.ai.publish(conversationId);
  }
}
