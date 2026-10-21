import { BadRequestException, HttpException } from '@nestjs/common';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Некорректный запрос');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, required = true): string {
  if (value === undefined && !required) return '';
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new BadRequestException('Проверьте заполнение полей');
  return value.trim();
}
export function uuid(value: unknown): string {
  const id = text(value, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new BadRequestException('Некорректный идентификатор');
  return id;
}
export function positiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new BadRequestException('Некорректный номер сообщения');
  return value;
}

/** Bounded, expiring limiter. Run one API instance; use a shared limiter before scaling. */
export class ChatLimiter {
  private entries = new Map<string, { count: number; until: number }>();
  check(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    if (this.entries.size > 10000)
      for (const [id, item] of this.entries)
        if (item.until <= now) this.entries.delete(id);
    const previous = this.entries.get(key);
    const entry =
      previous && previous.until > now
        ? previous
        : { count: 0, until: now + windowMs };
    if (entry.count >= limit || (!previous && this.entries.size >= 20000))
      throw new HttpException('Слишком много запросов. Попробуйте позже.', 429);
    entry.count++;
    this.entries.set(key, entry);
  }
}
