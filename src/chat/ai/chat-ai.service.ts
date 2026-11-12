import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { ChatEvents } from '../chat.events';
import { ChatContextService } from './chat-context.service';
import { GigaChatClient } from './gigachat.client';

export const AI_REVIEW_MS = 7000;
const activeStatuses = ['QUEUED', 'GENERATING', 'PENDING'];
const draftSelect = {
  id: true,
  status: true,
  body: true,
  sendAt: true,
  error: true,
  updatedAt: true,
} as const;
export const aiSelect = {
  aiEnabled: true,
  aiRevision: true,
  aiDraft: { select: draftSelect },
} as const;
type AiRecord = Prisma.ChatConversationGetPayload<{ select: typeof aiSelect }>;

@Injectable()
export class ChatAiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatAiService.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private stopped = false;
  private generating = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: GigaChatClient,
    private readonly context: ChatContextService,
    private readonly events: ChatEvents,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick().catch(() =>
        this.logger.error('AI queue processing failed'),
      );
    }, 250);
    this.timer.unref();
  }

  onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
  }

  state(record: AiRecord) {
    return {
      enabled: record.aiEnabled,
      configured: this.client.configured,
      revision: record.aiRevision,
      serverNow: new Date().toISOString(),
      draft: record.aiDraft,
    };
  }

  async publish(conversationId: string) {
    const row = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: aiSelect,
    });
    if (row)
      this.events.managers('chat:ai', { conversationId, ...this.state(row) });
  }

  // All mutations first lock the conversation via UPDATE, then touch its draft.
  // This lock order serializes send, takeover, new visitor messages and dispatch.
  async cancel(tx: Prisma.TransactionClient, conversationId: string) {
    await tx.chatAiDraft.updateMany({
      where: { conversationId, status: { in: activeStatuses } },
      data: {
        status: 'CANCELLED',
        sendAt: null,
        leaseUntil: null,
        leaseToken: null,
      },
    });
  }

  async enqueue(
    tx: Prisma.TransactionClient,
    conversation: { id: string; aiEnabled: boolean; aiRevision: number },
    triggerMessageId: number,
  ) {
    await this.cancel(tx, conversation.id);
    if (!conversation.aiEnabled || !this.client.configured) return;
    // Bound automated turns per conversation; a person can still continue normally.
    if (
      (await tx.chatMessage.count({
        where: { conversationId: conversation.id, sender: 'AI' },
      })) >= 40
    ) {
      await tx.chatConversation.update({
        where: { id: conversation.id },
        data: { aiEnabled: false },
      });
      return;
    }
    const data = {
      id: randomUUID(),
      revision: conversation.aiRevision,
      triggerMessageId,
      status: 'QUEUED',
      body: null,
      sendAt: null,
      leaseUntil: null,
      leaseToken: null,
      error: null,
      model: this.client.model,
    };
    await tx.chatAiDraft.upsert({
      where: { conversationId: conversation.id },
      create: { conversationId: conversation.id, ...data },
      update: data,
    });
  }

  async mode(conversationId: string, enabled: boolean, draftId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.chatConversation.update({
        where: { id: conversationId },
        data: { aiRevision: { increment: 1 } },
        include: { aiDraft: true },
      });
      if (
        draftId &&
        (row.aiDraft?.id !== draftId ||
          !activeStatuses.includes(row.aiDraft.status))
      )
        throw new ConflictException(
          'Черновик уже изменился или отправлен. Обновите переписку.',
        );
      if (enabled && row.closed)
        throw new ConflictException('Переписка завершена');
      if (enabled && !this.client.configured)
        throw new ConflictException('GigaChat ещё не подключён');
      await tx.chatConversation.update({
        where: { id: conversationId },
        data: { aiEnabled: enabled },
      });
      await this.cancel(tx, conversationId);
      if (enabled) {
        const last = await tx.chatMessage.findFirst({
          where: { conversationId },
          orderBy: { id: 'desc' },
        });
        if (last?.sender === 'VISITOR')
          await this.enqueue(tx, { ...row, aiEnabled: true }, last.id);
      }
    });
    await this.publish(conversationId);
    const row = await this.prisma.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: aiSelect,
    });
    return { conversationId, ...this.state(row) };
  }

  async tick() {
    if (this.ticking || this.stopped || !this.client.configured) return;
    this.ticking = true;
    try {
      const now = new Date();
      const due = await this.prisma.chatAiDraft.findMany({
        where: { status: 'PENDING', sendAt: { lte: now } },
        take: 20,
      });
      for (const draft of due)
        await this.dispatch(draft.conversationId, draft.id);
      if (this.generating >= 2) return;
      const jobs = await this.prisma.chatAiDraft.findMany({
        where: {
          OR: [
            {
              status: 'QUEUED',
              updatedAt: { lte: new Date(Date.now() - 800) },
            },
            { status: 'GENERATING', leaseUntil: { lte: now } },
          ],
        },
        orderBy: { updatedAt: 'asc' },
        take: 2 - this.generating,
      });
      for (const job of jobs) {
        const leaseToken = randomUUID();
        const claimed = await this.prisma.chatAiDraft.updateMany({
          where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
          data: {
            status: 'GENERATING',
            leaseToken,
            leaseUntil: new Date(Date.now() + 90000),
          },
        });
        if (!claimed.count) continue;
        this.generating++;
        void this.generate(
          job.conversationId,
          job.id,
          job.triggerMessageId,
          leaseToken,
        )
          .catch(() => this.logger.error('AI generation failed to persist'))
          .finally(() => this.generating--);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async generate(
    conversationId: string,
    id: string,
    triggerMessageId: number,
    leaseToken: string,
  ) {
    await this.publish(conversationId);
    let body: string | null = null;
    let failed = false;
    try {
      body = await this.client.complete(
        await this.context.messages(conversationId, triggerMessageId),
      );
      if (!body.trim() || body.length > 4000) throw new Error('Invalid answer');
    } catch {
      failed = true;
      this.logger.warn(
        'GigaChat could not prepare an answer; conversation remains available to managers',
      );
    }
    if (this.stopped) return; // Another worker can reclaim the expired lease after restart.
    await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.update({
        where: { id: conversationId },
        data: { aiRevision: { increment: 0 } },
      });
      const draft = await tx.chatAiDraft.findUnique({
        where: { conversationId },
      });
      if (
        !draft ||
        draft.id !== id ||
        draft.leaseToken !== leaseToken ||
        draft.status !== 'GENERATING' ||
        !conversation.aiEnabled ||
        conversation.closed ||
        conversation.aiRevision !== draft.revision
      )
        return;
      await tx.chatAiDraft.update({
        where: { id },
        data: {
          status: failed ? 'FAILED' : 'PENDING',
          body: failed ? null : body,
          sendAt: failed ? null : new Date(Date.now() + AI_REVIEW_MS),
          leaseUntil: null,
          leaseToken: null,
          error: failed
            ? 'Не удалось подготовить ответ ИИ. Ответьте вручную или включите ИИ повторно.'
            : null,
        },
      });
    });
    await this.publish(conversationId);
  }

  private async dispatch(conversationId: string, id: string) {
    const message = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.update({
        where: { id: conversationId },
        data: { aiRevision: { increment: 0 } },
      });
      const draft = await tx.chatAiDraft.findUnique({
        where: { conversationId },
      });
      if (
        !draft ||
        draft.id !== id ||
        draft.status !== 'PENDING' ||
        !draft.sendAt ||
        draft.sendAt.getTime() > Date.now()
      )
        return;
      if (
        !conversation.aiEnabled ||
        conversation.closed ||
        conversation.expiresAt.getTime() <= Date.now() ||
        conversation.aiRevision !== draft.revision
      ) {
        await this.cancel(tx, conversationId);
        return;
      }
      const result = await tx.chatMessage.create({
        data: {
          conversationId,
          clientId: draft.id,
          sender: 'AI',
          body: draft.body!,
        },
        select: {
          id: true,
          conversationId: true,
          clientId: true,
          sender: true,
          body: true,
          createdAt: true,
          readAt: true,
        },
      });
      await tx.chatAiDraft.update({ where: { id }, data: { status: 'SENT' } });
      return result;
    });
    if (message) this.events.message(message);
    await this.publish(conversationId);
  }
}
