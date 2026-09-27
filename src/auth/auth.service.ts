import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'prisma/prisma.service';
import { fillDto } from 'utils/fill-dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeUsernameDto } from './dto/change-username.dto';
import { AuthTokenRdo } from './rdo/auth-token.rdo';
import { UserRdo } from './rdo/user.rdo';
import * as bcrypt from 'bcrypt';
import type { User } from 'generated/prisma/client';
import { LoginAttemptsService } from './login-attempts.service';

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin';
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-login-timing-check', 10);

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly loginAttempts: LoginAttemptsService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultUser();
  }

  private async ensureDefaultUser(): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { username: DEFAULT_USERNAME },
    });

    if (existing) {
      return;
    }

    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    await this.prisma.user.create({
      data: {
        username: DEFAULT_USERNAME,
        password: hashedPassword,
        role: 'admin',
      },
    });

    this.logger.log(`Создан пользователь по умолчанию: ${DEFAULT_USERNAME}`);
  }

  private mapUserToDto(user: User) {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async generateToken(user: User): Promise<string> {
    const payload = { sub: user.id, username: user.username, role: user.role };
    return this.jwtService.signAsync(payload);
  }

  async login(dto: LoginDto): Promise<AuthTokenRdo> {
    const user = await this.loginAttempts.authenticate(
      dto.username,
      async (tx) => {
        const found = await tx.user.findUnique({
          where: { username: dto.username.trim() },
        });
        const valid = await bcrypt.compare(
          dto.password,
          found?.password ?? DUMMY_PASSWORD_HASH,
        );
        return found && valid ? found : null;
      },
    );

    const token = await this.generateToken(user);

    return fillDto(AuthTokenRdo, {
      token,
      user: this.mapUserToDto(user),
    });
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<UserRdo> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Текущий пароль неверен');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return fillDto(UserRdo, this.mapUserToDto(updatedUser));
  }

  async changeUsername(
    userId: string,
    dto: ChangeUsernameDto,
  ): Promise<UserRdo> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Текущий пароль неверен');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { username: dto.newUsername },
    });

    if (existingUser) {
      throw new ConflictException(
        'Пользователь с таким логином уже существует',
      );
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { username: dto.newUsername },
    });

    return fillDto(UserRdo, this.mapUserToDto(updatedUser));
  }

  async getProfile(userId: string): Promise<UserRdo> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    return fillDto(UserRdo, this.mapUserToDto(user));
  }
}
