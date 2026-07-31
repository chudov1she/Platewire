import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { parseAndValidateTelegramLoginWidget } from '../telegram-login-widget.util.js';

const BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

function sign(fields: Record<string, string | number>): string {
  const dataCheckString = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secretKey = createHash('sha256').update(BOT_TOKEN).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

describe('telegram-login-widget', () => {
  it('accepts a valid freshly signed payload', () => {
    const auth_date = Math.floor(Date.now() / 1000);
    const base = {
      id: 42,
      first_name: 'Sergey',
      username: 'sergey',
      auth_date,
    };
    const hash = sign(base);
    const parsed = parseAndValidateTelegramLoginWidget(
      { ...base, hash },
      BOT_TOKEN,
    );
    assert.equal(parsed.id, 42);
    assert.equal(parsed.username, 'sergey');
  });

  it('rejects a tampered hash', () => {
    const auth_date = Math.floor(Date.now() / 1000);
    assert.throws(() =>
      parseAndValidateTelegramLoginWidget(
        {
          id: 1,
          first_name: 'X',
          auth_date,
          hash: '00'.repeat(32),
        },
        BOT_TOKEN,
      ),
    );
  });

  it('rejects a stale auth_date', () => {
    const auth_date = Math.floor(Date.now() / 1000) - 200_000;
    const base = { id: 1, first_name: 'X', auth_date };
    const hash = sign(base);
    assert.throws(() =>
      parseAndValidateTelegramLoginWidget({ ...base, hash }, BOT_TOKEN),
    );
  });
});
