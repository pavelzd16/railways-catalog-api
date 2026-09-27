import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { LoginRateLimitException } from './login-attempts.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeUsernameDto } from './dto/change-username.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

/** Запрос после JwtAuthGuard: JwtStrategy.validate кладёт в него пользователя из базы. */
type AuthenticatedRequest = { user: { id: string } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      return await this.authService.login(dto);
    } catch (error) {
      if (error instanceof LoginRateLimitException) {
        response.setHeader('Retry-After', error.retryAfter);
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: AuthenticatedRequest) {
    return this.authService.getProfile(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-username')
  changeUsername(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ChangeUsernameDto,
  ) {
    return this.authService.changeUsername(req.user.id, dto);
  }
}
