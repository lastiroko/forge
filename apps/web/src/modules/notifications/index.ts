import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';

const {
  notifications, notificationPreferences, gradingRuns, submissions, enrollments, solutions,
} = schema;

export type Notification = typeof notifications.$inferSelect;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;

export const GRADING_FINISHED_EVENT = 'grading_finished';
export const COMMENT_RECEIVED_EVENT = 'comment_received';

export type NotificationEvent =
  | { type: typeof GRADING_FINISHED_EVENT; runId: string; submissionId: string; score: number }
  | { type: typeof COMMENT_RECEIVED_EVENT; commentId: string; solutionId: string; body: string };

export async function notify(
  user: { id: string },
  event: NotificationEvent,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Notification> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const { type, ...payload } = event;
    const [inserted] = await db.insert(notifications).values({
      userId: user.id,
      eventType: type,
      payload,
    }).returning();
    return inserted;
  } finally {
    await pool.end();
  }
}

export async function preferences(
  user: { id: string },
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<NotificationPreference[]> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    return await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, user.id));
  } finally {
    await pool.end();
  }
}

export async function listForUser(
  user: { id: string },
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Notification[]> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    return await db.select().from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt));
  } finally {
    await pool.end();
  }
}

export async function markRead(
  user: { id: string },
  notificationIds: string[],
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<void> {
  if (notificationIds.length === 0) return;
  const { db, pool } = createDbClient(databaseUrl);
  try {
    await db.update(notifications).set({ readAt: new Date() }).where(and(
      eq(notifications.userId, user.id),
      inArray(notifications.id, notificationIds),
      isNull(notifications.readAt),
    ));
  } finally {
    await pool.end();
  }
}

export async function notifyRunCompleted(
  run: { id: string; score: number },
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Notification> {
  const { db, pool } = createDbClient(databaseUrl);
  let ownerId: string;
  let submissionId: string;
  try {
    const [row] = await db
      .select({ userId: enrollments.userId, submissionId: submissions.id })
      .from(gradingRuns)
      .innerJoin(submissions, eq(gradingRuns.submissionId, submissions.id))
      .innerJoin(enrollments, eq(submissions.enrollmentId, enrollments.id))
      .where(eq(gradingRuns.id, run.id));
    if (!row) throw new Error(`Notifications module: no owner found for grading run ${run.id}`);
    ownerId = row.userId;
    submissionId = row.submissionId;
  } finally {
    await pool.end();
  }
  return notify(
    { id: ownerId },
    { type: GRADING_FINISHED_EVENT, runId: run.id, submissionId, score: run.score },
    databaseUrl,
  );
}

export async function notifyCommentReceived(
  comment: { id: string; targetType: string; targetId: string; authorId: string; body: string },
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Notification | undefined> {
  if (comment.targetType !== 'solution') return undefined;

  const { db, pool } = createDbClient(databaseUrl);
  let ownerId: string;
  try {
    const [row] = await db
      .select({ userId: enrollments.userId })
      .from(solutions)
      .innerJoin(submissions, eq(solutions.submissionId, submissions.id))
      .innerJoin(enrollments, eq(submissions.enrollmentId, enrollments.id))
      .where(eq(solutions.id, comment.targetId));
    if (!row) throw new Error(`Notifications module: no owner found for solution ${comment.targetId}`);
    ownerId = row.userId;
  } finally {
    await pool.end();
  }

  if (ownerId === comment.authorId) return undefined;

  return notify(
    { id: ownerId },
    { type: COMMENT_RECEIVED_EVENT, commentId: comment.id, solutionId: comment.targetId, body: comment.body },
    databaseUrl,
  );
}
