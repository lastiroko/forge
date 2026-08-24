import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadEnv } from './env.js';

test('loadEnv returns parsed values for a valid environment', () => {
  const env = loadEnv({ DATABASE_URL: 'postgres://user:pass@localhost:5432/forge', PORT: '4000' });
  assert.deepEqual(env, { DATABASE_URL: 'postgres://user:pass@localhost:5432/forge', PORT: 4000 });
});

test('loadEnv throws naming the missing variable', () => {
  assert.throws(() => loadEnv({ PORT: '4000' }), /DATABASE_URL/);
});
