import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { GET } from './route.js';

test('submission event stream returns 404 for an unknown submission', async () => {
  const id = randomUUID();
  const response = await GET(new Request(`http://localhost/submissions/${id}/events`), { params: { id } });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not found' });
});
