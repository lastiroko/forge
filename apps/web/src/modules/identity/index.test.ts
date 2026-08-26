import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { getCurrentUser, requireRole } from './index.js';

test('getCurrentUser rejects because the identity module is a skeleton', async () => {
  await assert.rejects(() => getCurrentUser(), /not implemented/);
});

test('requireRole rejects because the identity module is a skeleton', async () => {
  await assert.rejects(() => requireRole('member'), /not implemented/);
});
