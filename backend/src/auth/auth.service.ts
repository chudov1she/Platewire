import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '../generated/prisma/client.js';
import type { SafeUser } from '../users/users.service.js';
import { UsersService } from '../users/users.service.js';
import {
  parseAndValidateTelegramLoginWidget,
  type TelegramLoginWidgetPayload,
} from './telegram-login-widget.util.js';
import { parseAndValidateTelegramWebAppInitData } from './telegram-webapp.util.js';

export type AuthTokens = {
  accessToken: string;
  expiresIn: string;
  rememberMe: boolean;
  user: SafeUser;
};

export type JwtPayload = {
  sub: string;
  status: UserStatus;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private assertCanAccessWeb(status: UserStatus): void {
    if (status === UserStatus.GUEST) {
      throw new ForbiddenException(
        'Access pending approval. Your account is a guest until an admin upgrades it.',
      );
    }
  }

  private resolveExpiresIn(rememberMe: boolean): string {
    if (rememberMe) {
      return this.configService.get<string>('JWT_REMEMBER_EXPIRES_IN') ?? '30d';
    }
    return this.configService.get<string>('JWT_EXPIRES_IN') ?? '12h';
  }

  private async issueToken(
    userId: string,
    status: UserStatus,
    rememberMe: boolean,
  ): Promise<{ accessToken: string; expiresIn: string }> {
    const expiresIn = this.resolveExpiresIn(rememberMe);
    const payload: JwtPayload = { sub: userId, status };
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: expiresIn as `${number}d` | `${number}h`,
    });
    return { accessToken, expiresIn };
  }

  async login(
    login: string,
    password: string,
    rememberMe = false,
  ): Promise<AuthTokens> {
    const user = await this.usersService.findByLogin(login);
    if (!user) {
      throw new UnauthorizedException('Invalid login or password');
    }

    const valid = await this.usersService.validatePassword(user, password);
    if (!valid) {
      throw new UnauthorizedException('Invalid login or password');
    }

    this.assertCanAccessWeb(user.status);

    const { accessToken, expiresIn } = await this.issueToken(
      user.id,
      user.status,
      rememberMe,
    );
    return {
      accessToken,
      expiresIn,
      rememberMe,
      user: this.usersService.sanitize(user),
    };
  }

  async loginWithTelegramWidget(
    payload: TelegramLoginWidgetPayload,
    rememberMe = false,
  ): Promise<AuthTokens> {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      throw new UnauthorizedException('Telegram auth is not configured');
    }

    let parsed: TelegramLoginWidgetPayload;
    try {
      parsed = parseAndValidateTelegramLoginWidget(payload, botToken);
    } catch {
      throw new UnauthorizedException('Invalid Telegram login payload');
    }

    const displayName = [parsed.first_name, parsed.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    const user = await this.usersService.upsertFromTelegram({
      telegramId: String(parsed.id),
      telegramUsername: parsed.username,
      telegramFirstName: parsed.first_name,
      telegramLastName: parsed.last_name,
      telegramPhotoUrl: parsed.photo_url,
      displayName: displayName || undefined,
      avatarUrl: parsed.photo_url,
    });

    this.assertCanAccessWeb(user.status);

    const { accessToken, expiresIn } = await this.issueToken(
      user.id,
      user.status,
      rememberMe,
    );
    return {
      accessToken,
      expiresIn,
      rememberMe,
      user: this.usersService.sanitize(user),
    };
  }

  async loginWithTelegramWebApp(
    initData: string,
    rememberMe = true,
  ): Promise<AuthTokens> {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      throw new UnauthorizedException('Telegram auth is not configured');
    }

    let parsed;
    try {
      parsed = parseAndValidateTelegramWebAppInitData(initData, botToken);
    } catch {
      throw new UnauthorizedException('Invalid Telegram WebApp initData');
    }

    const u = parsed.user;
    const displayName = [u.first_name, u.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    const user = await this.usersService.upsertFromTelegram({
      telegramId: String(u.id),
      telegramUsername: u.username,
      telegramFirstName: u.first_name,
      telegramLastName: u.last_name,
      telegramPhotoUrl: u.photo_url,
      displayName: displayName || undefined,
      avatarUrl: u.photo_url,
    });

    this.assertCanAccessWeb(user.status);

    const { accessToken, expiresIn } = await this.issueToken(
      user.id,
      user.status,
      rememberMe,
    );
    return {
      accessToken,
      expiresIn,
      rememberMe,
      user: this.usersService.sanitize(user),
    };
  }
}
