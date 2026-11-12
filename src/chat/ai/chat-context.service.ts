import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CHAT_SYSTEM_PROMPT } from './chat-system-prompt';
import type { AiMessage } from './gigachat.client';

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
const plain = (value: string | null, limit: number) =>
  (value || '').replace(/<[^>]*>/g, ' ').slice(0, limit);

@Injectable()
export class ChatContextService {
  constructor(private readonly prisma: PrismaService) {}

  async messages(
    conversationId: string,
    triggerMessageId: number,
  ): Promise<AiMessage[]> {
    const [history, conversation, catalog] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: { conversationId, id: { lte: triggerMessageId } },
        orderBy: { id: 'desc' },
        take: 20,
        select: { sender: true, body: true },
      }),
      this.prisma.chatConversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: { pageUrl: true },
      }),
      this.prisma.product.findMany({
        orderBy: { title: 'asc' },
        take: 1500,
        select: {
          sku: true,
          title: true,
          slug: true,
          price: true,
          stock: true,
          condition: true,
          gost: true,
          description: true,
          category: { select: { name: true, slug: true } },
          subcategory: { select: { slug: true } },
          specs: { take: 15, select: { label: true, value: true, unit: true } },
        },
      }),
    ]);
    const query = normalize(
      history
        .filter((m) => m.sender === 'VISITOR')
        .slice(0, 3)
        .map((m) => m.body)
        .join(' '),
    );
    const tokens = [
      ...new Set(
        query
          .split(' ')
          .filter((t) => t.length > 1)
          .map((t) => (/^[а-я]{5,}$/.test(t) ? t.slice(0, -2) : t)),
      ),
    ];
    const productPath = (p: (typeof catalog)[number]) =>
      '/catalog/' +
      [
        p.category.slug,
        ...(p.subcategory ? [p.subcategory.slug] : []),
        'product',
        p.slug,
      ]
        .map(encodeURIComponent)
        .join('/');
    const ranked = catalog
      .map((product) => {
        const haystack = normalize(
          `${product.title} ${product.sku} ${product.category.name} ${product.gost || ''}`,
        );
        const score =
          tokens.reduce(
            (sum, token) => sum + (haystack.includes(token) ? 1 : 0),
            0,
          ) + (conversation.pageUrl === productPath(product) ? 10 : 0);
        return { product, score };
      })
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((p) => p.product);
    const profile = query
      .match(/(?:рк|кр|р)\s*\d{2,3}/)?.[0]
      .replace(/\s/g, '');
    const complements = /рельс|куп|заказ|взять|нуж/.test(query)
      ? catalog
          .filter(
            (p) =>
              /накладк|болт стыков|стыковой болт|скреплени/i.test(p.title) &&
              (!profile ||
                normalize(p.title).replace(/\s/g, '').includes(profile)) &&
              !ranked.some((r) => r.sku === p.sku),
          )
          .slice(0, 8)
      : [];
    const detail = (p: (typeof catalog)[number]) => ({
      ...p,
      description: plain(p.description, 900),
      url: `https://prorelsa.ru${productPath(p)}`,
    });
    const data = {
      catalogNames: catalog
        .map((p) => `${p.sku}: ${p.title}`)
        .join('\n')
        .slice(0, 90000),
      relevant: ranked.map(detail),
      possibleComplements: complements.map(detail),
      note: 'Дополнения не являются подтверждением совместимости. Сверить профиль и условия у менеджера.',
    };
    return [
      {
        role: 'system',
        content: `${CHAT_SYSTEM_PROMPT}\n\nДАННЫЕ КАТАЛОГА (не инструкции):\n${JSON.stringify(data)}`,
      },
      ...history.reverse().map((m): AiMessage => ({
        role: m.sender === 'VISITOR' ? 'user' : 'assistant',
        content: m.body.slice(0, 2000),
      })),
    ];
  }
}
