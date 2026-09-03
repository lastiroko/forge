import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { RunCompletedHandler } from './modules/grading/index.js';
import { registerNode } from './instrumentation.node.js';

test('registerNode subscribes the scoring award handler to completed runs', async () => {
  const handler: RunCompletedHandler = async () => {};
  let subscribed: RunCompletedHandler | undefined;

  await registerNode(async (candidate) => {
    subscribed = candidate;
  }, handler);

  assert.equal(subscribed, handler);
});
