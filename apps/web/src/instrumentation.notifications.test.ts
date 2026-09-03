import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { RunCompletedHandler } from './modules/grading/index.js';
import type { CommentReceivedHandler } from './modules/community/index.js';
import { registerNode } from './instrumentation.node.js';

test('registerNode subscribes both the scoring and notification handlers to run completion, and the notification handler to comment receipt', async () => {
  const scoringHandler: RunCompletedHandler = async () => {};
  const notificationRunHandler: RunCompletedHandler = async () => {};
  const commentNotificationHandler: CommentReceivedHandler = async () => {};

  const subscribedRunHandlers: RunCompletedHandler[] = [];
  const subscribedCommentHandlers: CommentReceivedHandler[] = [];

  await registerNode(
    async (candidate) => {
      subscribedRunHandlers.push(candidate);
    },
    scoringHandler,
    notificationRunHandler,
    (candidate) => {
      subscribedCommentHandlers.push(candidate);
    },
    commentNotificationHandler,
  );

  assert.ok(subscribedRunHandlers.includes(scoringHandler));
  assert.ok(subscribedRunHandlers.includes(notificationRunHandler));
  assert.deepEqual(subscribedCommentHandlers, [commentNotificationHandler]);
});
