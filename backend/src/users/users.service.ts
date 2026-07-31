import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';
import type { User } from '../generated/prisma/client.js';
import { UserStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateUserDto,
  UpdateCredentialsDto,
  UpdateUserStatusDto,
} from './dto/users.dto.js';

export type SafeUser = Omit<User, 'passwordHash'>;

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureAdminFromEnv();
  }

  /** Upsert ADMIN from ADMIN_LOGIN / ADMIN_PASSWORD (compose / local .env). */
  async ensureAdminFromEnv(): Promise<void> {
    const login = this.config.get<string>('ADMIN_LOGIN')?.trim() || 'admin';
    const password =
      this.config.get<string>('ADMIN_PASSWORD')?.trim() || 'admin';
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.user.upsert({
      where: { login },
      update: {
        passwordHash,
        status: UserStatus.ADMIN,
        displayName: 'Admin',
      },
      create: {
        login,
        passwordHash,
        status: UserStatus.ADMIN,
        displayName: 'Admin',
      },
    });
    this.logger.log(`Admin user ensured: login=${login}`);
  }

  sanitize(user: User): SafeUser {
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByLogin(login: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { login } });
  }

  async findByTelegramId(telegramId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  async findAll(): Promise<SafeUser[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return users.map((user) => this.sanitize(user));
  }

  async getByIdOrThrow(id: string): Promise<SafeUser> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.sanitize(user);
  }

  async createByAdmin(dto: CreateUserDto, adminId: string): Promise<SafeUser> {
    if (dto.login && !dto.password) {
      throw new BadRequestException('Password is required when login is set');
    }
    if (dto.password && !dto.login) {
      throw new BadRequestException('Login is required when password is set');
    }
    if (!dto.login && !dto.telegramId) {
      throw new BadRequestException(
        'Provide at least login/password or telegramId',
      );
    }

    if (dto.login) {
      const existingLogin = await this.findByLogin(dto.login);
      if (existingLogin) {
        throw new ConflictException('Login already taken');
      }
    }
    if (dto.telegramId) {
      const existingTelegram = await this.findByTelegramId(dto.telegramId);
      if (existingTelegram) {
        throw new ConflictException('Telegram ID already linked');
      }
    }

    const status = dto.status ?? UserStatus.USER;
    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : null;

    const user = await this.prisma.user.create({
      data: {
        login: dto.login,
        passwordHash,
        telegramId: dto.telegramId,
        telegramUsername: dto.telegramUsername,
        displayName: dto.displayName,
        avatarUrl: dto.avatarUrl,
        status,
        createdByAdminId: adminId,
      },
    });

    return this.sanitize(user);
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto): Promise<SafeUser> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.status === UserStatus.ADMIN) {
      throw new BadRequestException('Cannot change admin status via API');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: dto.status },
    });
    return this.sanitize(updated);
  }

  async setCredentials(
    id: string,
    dto: UpdateCredentialsDto,
  ): Promise<SafeUser> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existingLogin = await this.findByLogin(dto.login);
    if (existingLogin && existingLogin.id !== id) {
      throw new ConflictException('Login already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        login: dto.login,
        passwordHash,
      },
    });
    return this.sanitize(updated);
  }

  async upsertFromTelegram(data: {
    telegramId: string;
    telegramUsername?: string;
    telegramFirstName?: string;
    telegramLastName?: string;
    telegramPhotoUrl?: string;
    displayName?: string;
    avatarUrl?: string;
  }): Promise<User> {
    const existing = await this.findByTelegramId(data.telegramId);
    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          telegramUsername:
            data.telegramUsername ?? existing.telegramUsername,
          telegramFirstName:
            data.telegramFirstName ?? existing.telegramFirstName,
          telegramLastName: data.telegramLastName ?? existing.telegramLastName,
          telegramPhotoUrl: data.telegramPhotoUrl ?? existing.telegramPhotoUrl,
          displayName: data.displayName ?? existing.displayName,
          avatarUrl: data.avatarUrl ?? existing.avatarUrl,
        },
      });
    }

    return this.prisma.user.create({
      data: {
        telegramId: data.telegramId,
        telegramUsername: data.telegramUsername,
        telegramFirstName: data.telegramFirstName,
        telegramLastName: data.telegramLastName,
        telegramPhotoUrl: data.telegramPhotoUrl,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl,
        status: UserStatus.GUEST,
      },
    });
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    if (!user.passwordHash) {
      return false;
    }
    return bcrypt.compare(password, user.passwordHash);
  }
}
