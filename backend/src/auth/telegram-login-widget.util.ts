import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export type TelegramLoginWidgetPayload = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

/**
 * Validates Telegram Login Widget payload.
 * Docs: https://core.telegram.org/widgets/login#checking-authorization
 *
 * secret_key = SHA256(bot_token)
 * data_check_string = sorted "key=value" pairs (excluding hash) joined by \n
 * hash = HMAC_SHA256(secret_key, data_check_string) as hex
 */
export function parseAndValidateTelegramLoginWidget(
  payload: TelegramLoginWidgetPayload,
  botToken: string,
  maxAgeSeconds = 86_400,
): TelegramLoginWidgetPayload {
  const { hash, ...rest } = payload;
  if (!hash || typeof hash !== 'string') {
    throw new Error('Missing hash');
  }
  if (!Number.isFinite(payload.id) || payload.id <= 0) {
    throw new Error('Invalid id');
  }
  if (!payload.first_name || typeof payload.first_name !== 'string') {
    throw new Error('Missing first_name');
  }
  if (!Number.isFinite(payload.auth_date)) {
    throw new Error('Invalid auth_date');
  }

  const age = Math.floor(Date.now() / 1000) - Number(payload.auth_date);
  if (age > maxAgeSeconds || age < -60) {
    throw new Error('Stale auth_date');
  }

  const dataCheckString = Object.entries(rest)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  const computed = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid hash');
  }

  return payload;
}
