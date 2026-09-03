import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const compose = readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
const envExample = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');

test('Mailpit exposes SMTP and web ports and has a healthcheck', () => {
  assert.match(compose, /- '1025:1025'/);
  assert.match(compose, /- '8025:8025'/);
  assert.match(compose, /\['CMD', '\/mailpit', 'readyz'\]/);
});

test('web receives SMTP settings with local defaults and waits for Mailpit', () => {
  assert.match(compose, /SMTP_HOST: \$\{SMTP_HOST:-mailpit\}/);
  assert.match(compose, /SMTP_PORT: \$\{SMTP_PORT:-1025\}/);
  assert.match(compose, /SMTP_SECURE: \$\{SMTP_SECURE:-false\}/);
  assert.match(compose, /EMAIL_FROM: \$\{EMAIL_FROM:-Forge <notifications@forge\.local>\}/);
  assert.match(compose, /x-mailpit-ready: &mailpit-ready service_healthy/);
  assert.match(compose, /mailpit:\n        condition: \*mailpit-ready/);
});

test('.env.example documents every SMTP setting', () => {
  for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'EMAIL_FROM']) {
    assert.match(envExample, new RegExp(`^${name}=`, 'm'));
  }
});
