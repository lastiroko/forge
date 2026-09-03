import { onRunCompleted, type RunCompletedHandler } from './modules/grading/index.js';
import { award } from './modules/scoring/index.js';

type Subscribe = (handler: RunCompletedHandler) => Promise<unknown>;

export async function registerNode(
  subscribe: Subscribe = onRunCompleted,
  handler: RunCompletedHandler = award,
): Promise<void> {
  await subscribe(handler);
}

if (process.env.NEXT_RUNTIME === 'nodejs') {
  await registerNode();
}
