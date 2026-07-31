import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { User, UserStatus } from '../../generated/prisma/client.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { STATUSES_KEY } from '../decorators/statuses.decorator.js';
import {
  DEFAULT_ALLOWED_STATUSES,
  hasAllowedStatus,
} from '../utils/status.util.js';

type RequestWithUser = Request & { user?: User };

@Injectable()
export class StatusesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const allowedStatuses =
      this.reflector.getAllAndOverride<UserStatus[]>(STATUSES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_ALLOWED_STATUSES;

    const user = context.switchToHttp().getRequest<RequestWithUser>().user;

    if (!user) {
      throw new ForbiddenException('User context is missing');
    }

    if (!hasAllowedStatus(user.status, allowedStatuses)) {
      throw new ForbiddenException('Insufficient access status');
    }

    return true;
  }
}
