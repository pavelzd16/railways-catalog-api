import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
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
  readonly limiter = new ChatLimiter();
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async createSession(input: unknown, ip: string) {
    this.limiter.check(`session:${ip}`, 10, 3600000);
    const data = record(input);
    if (data.policyAccepted !== true)
      throw new ForbiddenException('Нужно согласие на обработку данных');
    const visitorName = text(data.name, 80);
    const contact = text(data.contact, 160, false);
    const page = text(data.pageUrl, 1000, false);
    // Store only a same-site path, not query parameters or credentials.
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
    return { conversation, token };
  }

  async authenticate(input: unknown): Promise<ChatActor> {
    const auth = record(input);
    if (auth.adminToken) {
      try {
        if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
        const payload = await this.jwt.verifyAsync<{
          sub: string;
          exp: number;
        }>(text(auth.adminToken, 4096), { secret: process.env.JWT_SECRET });
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
        });
        if (!user || user.role !== 'admin') throw new Error('Unauthorized');
        return {
          role: 'MANAGER',
          id: user.id,
          expiresAt: payload.exp
            ? payload.exp * 1000
            : Date.now() + 12 * 3600000,
        };
      } catch {
        throw new UnauthorizedException('Войдите в админку заново');
      }
    }
    const token = text(auth.token, 64);
    if (!/^[0-9a-f]{64}$/.test(token))
      throw new UnauthorizedException('Сессия чата недействительна');
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { tokenHash: hash(token) },
    });
    if (!conversation || conversation.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException('Сессия чата истекла');
    return {
      role: 'VISITOR',
      id: conversation.id,
      expiresAt: conversation.expiresAt.getTime(),
    };
  }

  authorize(actor: ChatActor, conversationId?: unknown) {
    if (!actor || actor.expiresAt <= Date.now())
      throw new UnauthorizedException('Сессия истекла. Войдите заново.');
    if (conversationId !== undefined) {
      const id = uuid(conversationId);
      if (actor.role !== 'MANAGER' && actor.id !== id)
        throw new ForbiddenException('Нет доступа к переписке');
      return id;
    }
    if (actor.role !== 'MANAGER') throw new ForbiddenException('Нет доступа');
    return '';
  }

  async list(actor: ChatActor, input: unknown) {
    this.authorize(actor);
    const data = record(input);
    const page =
      data.page === undefined ? 1 : Math.min(positiveInt(data.page), 10000);
    const search = text(data.search, 100, false);
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
    return {
      items: items.map(({ _count, messages, ...item }) => ({
        ...item,
        unread: _count.messages,
        lastMessage: messages[0],
      })),
      total,
      page,
    };
  }

  async history(actor: ChatActor, input: unknown) {
    const data = record(input);
    const id = this.authorize(actor, data.conversationId);
    const before =
      data.before === undefined ? undefined : positiveInt(data.before);
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { id },
      select: conversationSelect,
    });
    if (!conversation) throw new NotFoundException('Переписка не найдена');
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId: id, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: 51,
      select: messageSelect,
    });
    return {
      conversation,
      hasMore: messages.length > 50,
      messages: messages.slice(0, 50).reverse(),
    };
  }

  async send(actor: ChatActor, input: unknown) {
    const data = record(input);
    const conversationId = this.authorize(actor, data.conversationId);
    const clientId = uuid(data.clientId);
    const body = text(data.body, 4000);
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
    if (existing) return { message: existing, created: false };
    this.limiter.check(
      `send:${actor.role}:${actor.id}`,
      actor.role === 'MANAGER' ? 120 : 30,
      60000,
    );
    try {
      const message = await this.prisma.$transaction(async (tx) => {
        await tx.chatConversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date(), closed: false },
        });
        return tx.chatMessage.create({
          data: {
            conversationId,
            clientId,
            sender: actor.role,
            body,
            notificationDueAt: actor.role === 'VISITOR' ? new Date() : null,
          },
          select: messageSelect,
        });
      });
      return { message, created: true };
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
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
    await this.prisma.chatMessage.updateMany({
      where: {
        conversationId,
        id: { lte: through },
        sender: actor.role === 'MANAGER' ? 'VISITOR' : 'MANAGER',
        readAt: null,
      },
      data: { readAt },
    });
    return { conversationId, through, reader: actor.role, readAt };
  }

  async close(actor: ChatActor, input: unknown) {
    this.authorize(actor);
    const data = record(input);
    const id = uuid(data.conversationId);
    return this.prisma.chatConversation.update({
      where: { id },
      data: { closed: true },
      select: conversationSelect,
    });
  }
}
