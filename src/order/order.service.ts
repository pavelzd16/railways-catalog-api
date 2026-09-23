import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { buildPagination } from 'utils/build-pagination.util';
import { fillDto } from 'utils/fill-dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { FindOrdersDto, OrderSort } from './dto/find-orders.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrdersRdo } from './rdo/orders.rdo';
import { OrderRdo } from './rdo/order.rdo';
import { NotifyService } from 'src/notify/notify.service';
import type { Prisma } from 'generated/prisma/client';

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

  private mapOrderToDto(o: OrderWithItems) {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      name: o.name,
      phone: o.phone,
      email: o.email,
      address: o.address,
      comment: o.comment,
      policyAccepted: o.policyAccepted,
      status: o.status,
      totalAmount: o.totalAmount,
      items: o.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        price: item.price,
        productTitle: item.productTitle,
        productSku: item.productSku,
        productSlug: item.productSlug,
        productImage: item.productImage,
        productId: item.productId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    };
  }

  private buildOrderBy(sort?: OrderSort): Prisma.OrderOrderByWithRelationInput {
    switch (sort) {
      case 'oldest':
        return { createdAt: 'asc' };
      case 'newest':
      default:
        return { createdAt: 'desc' };
    }
  }

  private buildWhere(query: FindOrdersDto): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { comment: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private async generateOrderNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const lastOrder = await this.prisma.order.findFirst({
      where: { orderNumber: { startsWith: `ORD-${year}-` } },
      orderBy: { createdAt: 'desc' },
    });

    let nextNumber = 1;
    if (lastOrder) {
      const parts = lastOrder.orderNumber.split('-');
      const lastNumber = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }

    return `ORD-${year}-${String(nextNumber).padStart(5, '0')}`;
  }

  async findAll(query: FindOrdersDto): Promise<OrdersRdo> {
    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sort);

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { items: true },
        skip: query.skip,
        take: query.take,
        orderBy,
      }),
      this.prisma.order.count({ where }),
    ]);

    const mapped = orders.map((o) => this.mapOrderToDto(o));

    return fillDto(OrdersRdo, {
      items: fillDto(OrderRdo, mapped),
      pagination: buildPagination(total, query),
    });
  }

  async findOne(id: string): Promise<OrderRdo> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return fillDto(OrderRdo, this.mapOrderToDto(order));
  }

  async create(dto: CreateOrderDto): Promise<OrderRdo> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Корзина пуста');
    }

    const productIds = dto.items.map((item) => item.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    if (products.length !== productIds.length) {
      throw new NotFoundException('Один или несколько товаров не найдены');
    }

    const productsMap = new Map(products.map((p) => [p.id, p]));

    // Остаток на складе заказ не ограничивает: у почти всех позиций каталога
    // он равен единице, то есть это заполнитель, а не настоящий склад.
    // Материалы ВСП берут сотнями, а корзина на сайте — запрос спецификации:
    // наличие и срок подтверждает менеджер, а не проверка при оформлении.
    for (const item of dto.items) {
      const product = productsMap.get(item.productId)!;

      if (item.quantity <= 0) {
        throw new BadRequestException(
          `Количество товара "${product.title}" должно быть больше нуля`,
        );
      }
    }

    let totalAmount = 0;
    const itemsData = dto.items.map((item) => {
      const product = productsMap.get(item.productId)!;
      // Каталог ВСП почти весь «по запросу»: цены у товара может не быть.
      // Раньше такая позиция роняла оформление, а значит корзина не работала
      // ни с одним товаром каталога. Позиция без цены идёт в заказ с нулевой
      // ценой, сумму заказа составляют только позиции с ценой, остальное
      // менеджер оценивает сам.
      const price = product.price ?? 0;
      totalAmount += price * item.quantity;

      return {
        productId: product.id,
        quantity: item.quantity,
        price,
        productTitle: product.title,
        productSku: product.sku,
        productSlug: product.slug,
        productImage: product.images?.[0] ?? null,
      };
    });

    const orderNumber = await this.generateOrderNumber();

    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        comment: dto.comment,
        policyAccepted: dto.policyAccepted,
        status: 'PENDING',
        totalAmount,
        items: {
          create: itemsData,
        },
      },
      include: { items: true },
    });

    // Письмо уходит в фоне: клиент не ждёт почтовый сервер.
    void this.notify.orderCreated(order);

    return fillDto(OrderRdo, this.mapOrderToDto(order));
  }

  async update(id: string, dto: UpdateOrderDto): Promise<OrderRdo> {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException('Order not found');
    }

    const data: Prisma.OrderUpdateInput = {};

    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    if (dto.comment !== undefined) {
      data.comment = dto.comment;
    }

    const order = await this.prisma.order.update({
      where: { id },
      data,
      include: { items: true },
    });

    if (dto.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
      await Promise.all(
        existing.items.map((item) =>
          this.prisma.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          }),
        ),
      );
    }

    return fillDto(OrderRdo, this.mapOrderToDto(order));
  }

  async delete(id: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.prisma.order.delete({ where: { id } });
  }
}
