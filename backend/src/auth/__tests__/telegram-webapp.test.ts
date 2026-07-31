import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { parseAndValidateTelegramWebAppInitData } from '../telegram-webapp.util.js';

const BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

function signInitData(fields: Record<string, string>): string {
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  return createHmac('sha256', secretKey).update(pairs).digest('hex');
}

function buildInitData(fields: Record<string, string>): string {
  const hash = signInitData(fields);
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

describe('telegram-webapp initData', () => {
  it('accepts a valid freshly signed initData', () => {
    const auth_date = String(Math.floor(Date.now() / 1000));
    const user = JSON.stringify({
      id: 2064202147,
      first_name: 'Nik',
      username: 'chudov1she0',
    });
    const initData = buildInitData({ user, auth_date });
    const parsed = parseAndValidateTelegramWebAppInitData(initData, BOT_TOKEN);
    assert.equal(parsed.user.id, 2064202147);
    assert.equal(parsed.user.username, 'chudov1she0');
  });

  it('rejects a tampered hash', () => {
    const auth_date = String(Math.floor(Date.now() / 1000));
    const user = JSON.stringify({ id: 1, first_name: 'X' });
    const initData = buildInitData({ user, auth_date }).replace(
      /hash=[0-9a-f]+/,
      `hash=${'00'.repeat(32)}`,
    );
    assert.throws(() =>
      parseAndValidateTelegramWebAppInitData(initData, BOT_TOKEN),
    );
  });

  it('rejects stale auth_date', () => {
    const auth_date = String(Math.floor(Date.now() / 1000) - 200_000);
    const user = JSON.stringify({ id: 1, first_name: 'X' });
    const initData = buildInitData({ user, auth_date });
    assert.throws(() =>
      parseAndValidateTelegramWebAppInitData(initData, BOT_TOKEN),
    );
  });
});
