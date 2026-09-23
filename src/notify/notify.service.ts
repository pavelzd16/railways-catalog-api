import { Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { getSiteUrl } from 'src/seo/site-url';
import {
  Letter,
  LetterFile,
  OrderForLetter,
  RequestForLetter,
  orderLetter,
  requestLetter,
} from './notify-letters';

const SENDER_NAME = 'Сайт traer.ru';

// Письмо о новом заказе или заявке на почту менеджера.
// Отправка никогда не отклоняет обещание и не бросает: заказ уже сохранён в базе,
// клиент получает ответ сразу, а сбой почты остаётся только в журнале сервера.
@Injectable()
export class NotifyService {
  logger: Pick<Logger, 'error' | 'warn' | 'log'> = new Logger(
    NotifyService.name,
  );
  transport: { sendMail(message: object): Promise<unknown> } | null = null;
  from?: { name: string; address: string };
  to?: string;
  siteUrl?: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    try {
      this.siteUrl = getSiteUrl();
    } catch {
      // Без SITE_URL письмо уходит без ссылки на админку.
    }

    if (!host || !user || !pass) {
      this.logger.warn(
        'Уведомления о заказах выключены: не заданы SMTP_HOST, SMTP_USER, SMTP_PASS',
      );
      return;
    }

    const port = Number(process.env.SMTP_PORT ?? 465);
    this.transport = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    this.from = { name: SENDER_NAME, address: user };
    this.to = process.env.NOTIFY_EMAIL || user;
  }

  orderCreated(order: OrderForLetter): Promise<void> {
    return this.deliver(`заказ ${order.orderNumber}`, () =>
      orderLetter(order, this.siteUrl),
    );
  }

  requestCreated(
    request: RequestForLetter,
    files: LetterFile[],
  ): Promise<void> {
    return this.deliver('заявка', () =>
      requestLetter(request, this.siteUrl, files),
    );
  }

  private async deliver(what: string, build: () => Letter): Promise<void> {
    if (!this.transport) return;
    try {
      const letter = build();
      await this.transport.sendMail({
        from: this.from,
        to: this.to,
        ...letter,
      });
    } catch (error) {
      this.logger.error(
        `Письмо не отправлено (${what}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
