import { onRunCompleted, type RunCompletedHandler } from './modules/grading/index.js';
import { award } from './modules/scoring/index.js';
import { onCommentReceived, type CommentReceivedHandler } from './modules/community/index.js';
import { notifyCommentReceived, notifyRunCompleted } from './modules/notifications/index.js';

type SubscribeRunCompleted = (handler: RunCompletedHandler) => Promise<unknown>;
type SubscribeCommentReceived = (handler: CommentReceivedHandler) => unknown;

const notifyOnRunCompleted: RunCompletedHandler = async (run) => {
  await notifyRunCompleted(run);
};

const notifyOnCommentReceived: CommentReceivedHandler = async (comment) => {
  await notifyCommentReceived(comment);
};

export async function registerNode(
  subscribeRunCompleted: SubscribeRunCompleted = onRunCompleted,
  scoringHandler: RunCompletedHandler = award,
  notificationRunHandler: RunCompletedHandler = notifyOnRunCompleted,
  subscribeCommentReceived: SubscribeCommentReceived = onCommentReceived,
  commentNotificationHandler: CommentReceivedHandler = notifyOnCommentReceived,
): Promise<void> {
  await subscribeRunCompleted(notificationRunHandler);
  await subscribeRunCompleted(scoringHandler);
  subscribeCommentReceived(commentNotificationHandler);
}
