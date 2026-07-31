import { SetMetadata } from '@nestjs/common';
import { UserStatus } from '../../generated/prisma/client.js';

export const STATUSES_KEY = 'statuses';
export const Statuses = (...statuses: UserStatus[]) =>
  SetMetadata(STATUSES_KEY, statuses);
