import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { buildPagination } from 'utils/build-pagination.util';
import { fillDto } from 'utils/fill-dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { FindRequestsDto, RequestSort } from './dto/find-requests.dto';
import { RequestsRdo } from './rdo/requests.rdo';
import { RequestRdo } from './rdo/request.rdo';
import { FileService } from 'src/file/file.service';
import type { Prisma } from 'generated/prisma/client';

type RequestWithRelations = Prisma.RequestGetPayload<{
  include: { service: true; product: true };
}>;

@Injectable()
export class RequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
  ) {}

  private mapRequestToDto(r: RequestWithRelations) {
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      comment: r.comment,
      policyAccepted: r.policyAccepted,
      requestFilePath: r.requestFilePath,
      partnerMapPath: r.partnerMapPath,
      serviceId: r.serviceId,
      service: r.service
        ? {
            id: r.service.id,
            slug: r.service.slug,
            title: r.service.title,
            description: r.service.description,
            fullDescription: r.service.fullDescription,
            features: r.service.features ?? [],
            // У модели Service нет поля images: в ответе оно всегда было пустым массивом.
            images: [],
            createdAt: r.service.createdAt,
            updatedAt: r.service.updatedAt,
          }
        : undefined,
      productId: r.productId,
      product: r.product
        ? {
            id: r.product.id,
            sku: r.product.sku,
            title: r.product.title,
            slug: r.product.slug,
            gost: r.product.gost,
            price: r.product.price,
            stock: r.product.stock,
            condition: r.product.condition,
            images: r.product.images ?? [],
            description: r.product.description,
            analogues: r.product.analogues ?? [],
            categoryId: r.product.categoryId,
            subcategoryId: r.product.subcategoryId,
            createdAt: r.product.createdAt,
            updatedAt: r.product.updatedAt,
          }
        : undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private buildOrderBy(
    sort?: RequestSort,
  ): Prisma.RequestOrderByWithRelationInput {
    switch (sort) {
      case 'oldest':
        return { createdAt: 'asc' };
      case 'newest':
      default:
        return { createdAt: 'desc' };
    }
  }

  private buildWhere(query: FindRequestsDto): Prisma.RequestWhereInput {
    const where: Prisma.RequestWhereInput = {};

    if (query.serviceId) {
      where.serviceId = query.serviceId;
    }

    if (query.productId) {
      where.productId = query.productId;
    }

    if (query.type === 'service') {
      where.serviceId = { not: null };
    }

    if (query.type === 'product') {
      where.productId = { not: null };
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { comment: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  async findAll(query: FindRequestsDto): Promise<RequestsRdo> {
    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sort);

    const [requests, total] = await Promise.all([
      this.prisma.request.findMany({
        where,
        include: {
          service: true,
          product: true,
        },
        skip: query.skip,
        take: query.take,
        orderBy,
      }),
      this.prisma.request.count({ where }),
    ]);

    const mapped = requests.map((r) => this.mapRequestToDto(r));

    return fillDto(RequestsRdo, {
      items: fillDto(RequestRdo, mapped),
      pagination: buildPagination(total, query),
    });
  }

  async findOne(id: string): Promise<RequestRdo> {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: {
        service: true,
        product: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    return fillDto(RequestRdo, this.mapRequestToDto(request));
  }

  async create(
    dto: CreateRequestDto,
    requestFile?: Express.Multer.File,
    partnerMapFile?: Express.Multer.File,
  ): Promise<RequestRdo> {
    if (dto.serviceId) {
      const service = await this.prisma.service.findUnique({
        where: { id: dto.serviceId },
      });

      if (!service) {
        throw new NotFoundException('Service not found');
      }
    }

    if (dto.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }
    }

    let requestFilePath: string | undefined;
    let partnerMapPath: string | undefined;

    if (requestFile) {
      requestFilePath = await this.fileService.saveFile(requestFile);
    }

    if (partnerMapFile) {
      partnerMapPath = await this.fileService.saveFile(partnerMapFile);
    }

    const request = await this.prisma.request.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        comment: dto.comment,
        policyAccepted: dto.policyAccepted,
        requestFilePath,
        partnerMapPath,
        serviceId: dto.serviceId,
        productId: dto.productId,
      },
      include: {
        service: true,
        product: true,
      },
    });

    return fillDto(RequestRdo, this.mapRequestToDto(request));
  }

  async delete(id: string): Promise<void> {
    const request = await this.prisma.request.findUnique({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    const filesToDelete: string[] = [];

    if (request.requestFilePath) {
      filesToDelete.push(request.requestFilePath);
    }

    if (request.partnerMapPath) {
      filesToDelete.push(request.partnerMapPath);
    }

    if (filesToDelete.length > 0) {
      await this.fileService.deleteFiles(filesToDelete);
    }

    await this.prisma.request.delete({ where: { id } });
  }
}
