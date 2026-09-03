import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadEnv } from './env.js';

const DATABASE_URL = 'postgres://user:pass@localhost:5432/forge';

test('loadEnv applies local Mailpit SMTP defaults', () => {
  const env = loadEnv({ DATABASE_URL });
  assert.deepEqual(
    { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, from: env.EMAIL_FROM },
    { host: 'mailpit', port: 1025, secure: false, from: 'Forge <notifications@forge.local>' },
  );
});

test('loadEnv parses explicit SMTP overrides', () => {
  const env = loadEnv({
    DATABASE_URL,
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    EMAIL_FROM: 'Forge Notifications <notifications@example.com>',
  });
  assert.equal(env.SMTP_HOST, 'smtp.example.com');
  assert.equal(env.SMTP_PORT, 465);
  assert.equal(env.SMTP_SECURE, true);
  assert.equal(env.EMAIL_FROM, 'Forge Notifications <notifications@example.com>');
});

test('loadEnv rejects invalid SMTP values', () => {
  assert.throws(() => loadEnv({ DATABASE_URL, SMTP_HOST: '' }), /SMTP_HOST/);
  assert.throws(() => loadEnv({ DATABASE_URL, SMTP_PORT: 'not-a-port' }), /SMTP_PORT/);
  assert.throws(() => loadEnv({ DATABASE_URL, SMTP_PORT: '70000' }), /SMTP_PORT/);
  assert.throws(() => loadEnv({ DATABASE_URL, SMTP_SECURE: 'yes' }), /SMTP_SECURE/);
  assert.throws(() => loadEnv({ DATABASE_URL, EMAIL_FROM: '' }), /EMAIL_FROM/);
});
