import { UserStatus } from '../../generated/prisma/client.js';

const STATUS_RANK: Record<UserStatus, number> = {
  [UserStatus.GUEST]: 0,
  [UserStatus.USER]: 1,
  [UserStatus.ADMIN]: 2,
};

export function hasAllowedStatus(
  status: UserStatus,
  allowed: UserStatus[],
): boolean {
  return allowed.includes(status);
}

export function isAtLeast(status: UserStatus, minimum: UserStatus): boolean {
  return STATUS_RANK[status] >= STATUS_RANK[minimum];
}

export const DEFAULT_ALLOWED_STATUSES: UserStatus[] = [
  UserStatus.USER,
  UserStatus.ADMIN,
];
