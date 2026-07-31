import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '../generated/prisma/client.js';
import { CurrentUser, Public } from '../common/index.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import {
  LoginDto,
  TelegramLoginDto,
  TelegramWebAppLoginDto,
} from './dto/auth.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Browser login with login/password (+ remember me)' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.login, dto.password, dto.rememberMe ?? false);
  }

  @Public()
  @Post('telegram')
  @ApiOperation({ summary: 'Telegram Login Widget auth' })
  telegram(@Body() dto: TelegramLoginDto) {
    return this.authService.loginWithTelegramWidget(
      {
        id: dto.id,
        first_name: dto.first_name,
        last_name: dto.last_name,
        username: dto.username,
        photo_url: dto.photo_url,
        auth_date: dto.auth_date,
        hash: dto.hash,
      },
      dto.rememberMe ?? false,
    );
  }

  @Public()
  @Post('telegram/webapp')
  @ApiOperation({
    summary:
      'Telegram Mini App auth via WebApp.initData (auto-login inside Telegram client)',
  })
  telegramWebApp(@Body() dto: TelegramWebAppLoginDto) {
    return this.authService.loginWithTelegramWebApp(
      dto.initData,
      dto.rememberMe ?? true,
    );
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current authenticated user' })
  me(@CurrentUser() user: User) {
    return this.usersService.sanitize(user);
  }
}
