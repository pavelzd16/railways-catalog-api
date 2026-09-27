import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'prisma/prisma.service';

export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export class LoginRateLimitException extends HttpException {
  constructor(readonly retryAfter: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Слишком много неверных попыток. Вход временно ограничен.',
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class LoginAttemptsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(LoginAttemptsService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.prisma.loginAttempt
        .deleteMany({ where: { expiresAt: { lte: new Date() } } })
        .catch(() =>
          this.logger.warn('Не удалось очистить истёкшие попытки входа'),
        );
    }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async authenticate<T>(
    username: string,
    verify: (tx: Prisma.TransactionClient) => Promise<T | null>,
  ): Promise<T> {
    const key = createHash('sha256')
      .update(username.trim().toLowerCase())
      .digest('hex');

    // Общий для всех процессов замок: параллельные запросы не обходят лимит.
    // Результат ошибки возвращаем из транзакции, чтобы сохранить счётчик.
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        const now = Date.now();
        const saved = await tx.loginAttempt.findUnique({ where: { key } });
        const active = saved && saved.expiresAt.getTime() > now ? saved : null;

        if (active && active.failures >= LOGIN_FAILURE_LIMIT) {
          return {
            kind: 'blocked' as const,
            until: active.expiresAt.getTime(),
          };
        }

        const user = await verify(tx);
        if (user !== null) {
          await tx.loginAttempt.deleteMany({ where: { key } });
          return { kind: 'success' as const, user };
        }

        const failures = (active?.failures ?? 0) + 1;
        const blocked = failures >= LOGIN_FAILURE_LIMIT;
        const expiresAt =
          blocked || !active
            ? new Date(Date.now() + LOGIN_WINDOW_MS)
            : active.expiresAt;
        await tx.loginAttempt.upsert({
          where: { key },
          create: { key, failures, expiresAt },
          update: { failures, expiresAt },
        });
        return blocked
          ? { kind: 'blocked' as const, until: expiresAt.getTime() }
          : {
              kind: 'invalid' as const,
              remaining: LOGIN_FAILURE_LIMIT - failures,
            };
      },
      { timeout: 10_000 },
    );

    if (result.kind === 'blocked') {
      throw new LoginRateLimitException(
        Math.max(1, Math.ceil((result.until - Date.now()) / 1000)),
      );
    }
    if (result.kind === 'invalid') {
      throw new UnauthorizedException({
        message: 'Неверный логин или пароль',
        attemptsRemaining: result.remaining,
      });
    }
    return result.user;
  }
}
