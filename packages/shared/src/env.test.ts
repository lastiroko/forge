import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadEnv } from './env.js';

test('loadEnv returns parsed values for a valid environment', () => {
  const env = loadEnv({ DATABASE_URL: 'postgres://user:pass@localhost:5432/forge', PORT: '4000' });
  assert.deepEqual(env, {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/forge',
    PORT: 4000,
    S3_ENDPOINT: 'http://minio:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'forge',
    S3_SECRET_ACCESS_KEY: 'forgeforge',
    S3_BUCKET: 'forge-reports',
    S3_FORCE_PATH_STYLE: true,
    SMTP_HOST: 'mailpit',
    SMTP_PORT: 1025,
    SMTP_SECURE: false,
    EMAIL_FROM: 'Forge <notifications@forge.local>',
  });
});

test('loadEnv throws naming the missing variable', () => {
  assert.throws(() => loadEnv({ PORT: '4000' }), /DATABASE_URL/);
});

test('loadEnv applies S3_* defaults matching docker-compose MinIO', () => {
  const env = loadEnv({ DATABASE_URL: 'postgres://user:pass@localhost:5432/forge' });
  assert.equal(env.S3_ENDPOINT, 'http://minio:9000');
  assert.equal(env.S3_BUCKET, 'forge-reports');
  assert.equal(env.S3_FORCE_PATH_STYLE, true);
});
