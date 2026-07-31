import { createHmac, timingSafeEqual } from 'node:crypto';

export type TelegramWebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
};

export type TelegramWebAppAuth = {
  user: TelegramWebAppUser;
  auth_date: number;
  hash: string;
  raw: Record<string, string>;
};

/**
 * Validates Telegram Mini App / WebApp `initData` query string.
 * Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
 * data_check_string = sorted "key=value" (excluding hash) joined by \n
 * hash = HMAC_SHA256(secret_key, data_check_string) as hex
 */
export function parseAndValidateTelegramWebAppInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
): TelegramWebAppAuth {
  if (!initData || typeof initData !== 'string') {
    throw new Error('Missing initData');
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('Missing hash');

  const pairs: string[] = [];
  const raw: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    raw[key] = value;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid hash');
  }

  const authDateRaw = raw.auth_date;
  const auth_date = Number(authDateRaw);
  if (!Number.isFinite(auth_date)) throw new Error('Invalid auth_date');

  const age = Math.floor(Date.now() / 1000) - auth_date;
  if (age > maxAgeSeconds || age < -60) {
    throw new Error('Stale auth_date');
  }

  const userRaw = raw.user;
  if (!userRaw) throw new Error('Missing user');
  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(userRaw) as TelegramWebAppUser;
  } catch {
    throw new Error('Invalid user JSON');
  }
  if (!Number.isFinite(user.id) || user.id <= 0) {
    throw new Error('Invalid user id');
  }
  if (!user.first_name || typeof user.first_name !== 'string') {
    throw new Error('Missing first_name');
  }

  return { user, auth_date, hash, raw };
}
