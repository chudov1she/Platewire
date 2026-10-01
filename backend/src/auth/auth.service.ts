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
}
