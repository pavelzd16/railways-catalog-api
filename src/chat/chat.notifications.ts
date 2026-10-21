import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { NotifyService } from 'src/notify/notify.service';

/** Messages themselves are the durable mail outbox. SMTP failure never loses a chat message. */
@Injectable()
export class ChatNotifications implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(ChatNotifications.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.flush();
    }, 15000);
    this.timer.unref();
    void this.flush();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async flush() {
    if (this.busy || !this.notify.transport) return;
    this.busy = true;
    try {
      const now = new Date();
      const eligible = {
        notificationSentAt: null,
        notificationDueAt: { lte: now },
        OR: [
          { notificationLockAt: null },
          { notificationLockAt: { lt: new Date(now.getTime() - 120000) } },
        ],
      };
      const messages = await this.prisma.chatMessage.findMany({
        where: eligible,
        take: 10,
        orderBy: { id: 'asc' },
        include: { conversation: true },
      });
      for (const message of messages) {
        const claimed = await this.prisma.chatMessage.updateMany({
          where: { id: message.id, ...eligible },
          data: {
            notificationLockAt: now,
            notificationTries: { increment: 1 },
          },
        });
        if (!claimed.count) continue;
        const delivered = await this.notify.chatMessageCreated(message);
        await this.prisma.chatMessage.update({
          where: { id: message.id },
          data: {
            notificationLockAt: null,
            ...(delivered
              ? { notificationSentAt: new Date(), notificationDueAt: null }
              : {
                  notificationDueAt: new Date(
                    Date.now() +
                      Math.min(
                        3600000,
                        30000 * 2 ** Math.min(message.notificationTries, 7),
                      ),
                  ),
                }),
          },
        });
      }
    } catch (error) {
      this.logger.error(
        'Не удалось обработать уведомления чата',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.busy = false;
    }
  }
}
