import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';
import nodemailer from 'nodemailer';

const {
  users, notifications, notificationPreferences, gradingRuns, submissions, enrollments, solutions,
} = schema;

export type Notification = typeof notifications.$inferSelect;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;

export const GRADING_FINISHED_EVENT = 'grading_finished';
export const COMMENT_RECEIVED_EVENT = 'comment_received';

export const EMAIL_PREFERENCES = [
  {
    eventType: GRADING_FINISHED_EVENT,
    label: 'Email me when grading finishes',
    subject: 'Your Forge grading run is finished',
  },
  {
    eventType: COMMENT_RECEIVED_EVENT,
    label: 'Email me when someone comments on my solution',
    subject: 'New comment on your Forge solution',
  },
] as const;

export type EmailPreferenceEvent = (typeof EMAIL_PREFERENCES)[number]['eventType'];

export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

function isEmailPreferenceEvent(eventType: string): eventType is EmailPreferenceEvent {
  return eventType === GRADING_FINISHED_EVENT || eventType === COMMENT_RECEIVED_EVENT;
}

function emailEnv(databaseUrl: string) {
  return loadEnv({ ...process.env, DATABASE_URL: databaseUrl });
}

function createMailTransport(databaseUrl: string): MailTransport {
  const env = emailEnv(databaseUrl);
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
  });
}

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

export async function setEmailPreference(
  user: { id: string },
  eventType: string,
  emailEnabled: boolean,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<NotificationPreference> {
  if (!isEmailPreferenceEvent(eventType)) {
    throw new Error(`Unsupported email preference event: ${eventType}`);
  }

  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [preference] = await db.insert(notificationPreferences).values({
      userId: user.id,
      eventType,
      emailEnabled,
    }).onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.eventType],
      set: { emailEnabled },
    }).returning();
    return preference;
  } finally {
    await pool.end();
  }
}

async function deliverEmail(
  recipient: { email: string; emailEnabled: boolean | null },
  eventType: EmailPreferenceEvent,
  text: string,
  databaseUrl: string,
  transport: MailTransport = createMailTransport(databaseUrl),
): Promise<void> {
  if (recipient.emailEnabled === false) return;
  const descriptor = EMAIL_PREFERENCES.find((preference) => preference.eventType === eventType);
  if (!descriptor) return;
  await transport.sendMail({
    from: emailEnv(databaseUrl).EMAIL_FROM,
    to: recipient.email,
    subject: descriptor.subject,
    text,
  });
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
  transport?: MailTransport,
): Promise<Notification> {
  const { db, pool } = createDbClient(databaseUrl);
  let ownerId: string;
  let submissionId: string;
  let recipient: { email: string; emailEnabled: boolean | null };
  try {
    const [row] = await db
      .select({
        userId: enrollments.userId,
        submissionId: submissions.id,
        email: users.email,
        emailEnabled: notificationPreferences.emailEnabled,
      })
      .from(gradingRuns)
      .innerJoin(submissions, eq(gradingRuns.submissionId, submissions.id))
      .innerJoin(enrollments, eq(submissions.enrollmentId, enrollments.id))
      .innerJoin(users, eq(enrollments.userId, users.id))
      .leftJoin(notificationPreferences, and(
        eq(notificationPreferences.userId, users.id),
        eq(notificationPreferences.eventType, GRADING_FINISHED_EVENT),
      ))
      .where(eq(gradingRuns.id, run.id));
    if (!row) throw new Error(`Notifications module: no owner found for grading run ${run.id}`);
    ownerId = row.userId;
    submissionId = row.submissionId;
    recipient = { email: row.email, emailEnabled: row.emailEnabled };
  } finally {
    await pool.end();
  }
  const notification = await notify(
    { id: ownerId },
    { type: GRADING_FINISHED_EVENT, runId: run.id, submissionId, score: run.score },
    databaseUrl,
  );
  await deliverEmail(
    recipient,
    GRADING_FINISHED_EVENT,
    `Your grading run is finished with a score of ${run.score}.`,
    databaseUrl,
    transport,
  );
  return notification;
}

export async function notifyCommentReceived(
  comment: { id: string; targetType: string; targetId: string; authorId: string; body: string },
  databaseUrl: string = loadEnv().DATABASE_URL,
  transport?: MailTransport,
): Promise<Notification | undefined> {
  if (comment.targetType !== 'solution') return undefined;

  const { db, pool } = createDbClient(databaseUrl);
  let ownerId: string;
  let recipient: { email: string; emailEnabled: boolean | null };
  try {
    const [row] = await db
      .select({
        userId: enrollments.userId,
        email: users.email,
        emailEnabled: notificationPreferences.emailEnabled,
      })
      .from(solutions)
      .innerJoin(submissions, eq(solutions.submissionId, submissions.id))
      .innerJoin(enrollments, eq(submissions.enrollmentId, enrollments.id))
      .innerJoin(users, eq(enrollments.userId, users.id))
      .leftJoin(notificationPreferences, and(
        eq(notificationPreferences.userId, users.id),
        eq(notificationPreferences.eventType, COMMENT_RECEIVED_EVENT),
      ))
      .where(eq(solutions.id, comment.targetId));
    if (!row) throw new Error(`Notifications module: no owner found for solution ${comment.targetId}`);
    ownerId = row.userId;
    recipient = { email: row.email, emailEnabled: row.emailEnabled };
  } finally {
    await pool.end();
  }

  if (ownerId === comment.authorId) return undefined;

  const notification = await notify(
    { id: ownerId },
    { type: COMMENT_RECEIVED_EVENT, commentId: comment.id, solutionId: comment.targetId, body: comment.body },
    databaseUrl,
  );
  await deliverEmail(
    recipient,
    COMMENT_RECEIVED_EVENT,
    `A new comment was posted on your solution:\n\n${comment.body}`,
    databaseUrl,
    transport,
  );
  return notification;
}
