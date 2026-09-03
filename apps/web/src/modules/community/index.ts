import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';
import { getChallenge } from '../catalogue/index.js';
import { requireRole, type SessionCookieReader } from '../identity/index.js';
import {
  getLatestGradingStatus,
  getSubmissionForUser,
  type Submission,
} from '../submissions/index.js';

const { solutions, comments, reports } = schema;

export type Solution = typeof solutions.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Report = typeof reports.$inferSelect;

export type CommentTarget =
  | { type: 'solution'; id: string }
  | { type: 'challenge'; id: string };

export type ReportTarget =
  | { type: 'solution'; id: string }
  | { type: 'comment'; id: string };

export type CommentReceivedHandler = (comment: Comment) => Promise<void> | void;

const commentReceivedHandlers = new Set<CommentReceivedHandler>();

export function onCommentReceived(handler: CommentReceivedHandler): () => void {
  commentReceivedHandlers.add(handler);
  return () => {
    commentReceivedHandlers.delete(handler);
  };
}

export async function publish(
  submission: Submission,
  title: string,
  writeup: string,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Solution> {
  const user = await requireRole('member', cookieStore, databaseUrl);
  const persistedSubmission = await getSubmissionForUser(submission.id, user.id, databaseUrl);
  if (!persistedSubmission) {
    throw new Error('Community module: submission does not belong to the current user');
  }

  const gradingStatus = await getLatestGradingStatus(persistedSubmission.id, databaseUrl);
  if (
    gradingStatus?.status !== 'successful'
    || typeof gradingStatus.score !== 'number'
    || !Number.isFinite(gradingStatus.score)
    || gradingStatus.score < 70
  ) {
    throw new Error('Community module: submission is not completed');
  }

  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [solution] = await db.insert(solutions).values({
      submissionId: persistedSubmission.id,
      title,
      writeup,
      publishedAt: new Date(),
    }).returning();
    return solution;
  } finally {
    await pool.end();
  }
}

export async function comment(
  target: CommentTarget,
  body: string,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Comment> {
  const user = await requireRole('member', cookieStore, databaseUrl);

  if (target.type === 'challenge') {
    if (!await getChallenge(target.id, databaseUrl)) {
      throw new Error(`Community module: no challenge found with id ${target.id}`);
    }
  } else if (target.type === 'solution') {
    const { db, pool } = createDbClient(databaseUrl);
    try {
      const [solution] = await db.select({ id: solutions.id }).from(solutions).where(eq(solutions.id, target.id));
      if (!solution) throw new Error(`Community module: no solution found with id ${target.id}`);
    } finally {
      await pool.end();
    }
  } else {
    throw new Error('Community module: unsupported comment target');
  }

  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [inserted] = await db.insert(comments).values({
      targetType: target.type,
      targetId: target.id,
      authorId: user.id,
      body,
    }).returning();
    if (inserted.targetType === 'solution') {
      for (const handler of commentReceivedHandlers) await handler(inserted);
    }
    return inserted;
  } finally {
    await pool.end();
  }
}

export async function report(
  target: ReportTarget,
  reason: string,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Report> {
  const user = await requireRole('member', cookieStore, databaseUrl);
  const { db, pool } = createDbClient(databaseUrl);
  try {
    let existing: { id: string } | undefined;
    if (target.type === 'solution') {
      [existing] = await db.select({ id: solutions.id }).from(solutions).where(eq(solutions.id, target.id));
    } else if (target.type === 'comment') {
      [existing] = await db.select({ id: comments.id }).from(comments).where(eq(comments.id, target.id));
    } else {
      throw new Error('Community module: unsupported report target');
    }
    if (!existing) {
      throw new Error(`Community module: no ${target.type} found with id ${target.id}`);
    }

    const [inserted] = await db.insert(reports).values({
      targetType: target.type,
      targetId: target.id,
      reporterId: user.id,
      reason,
    }).returning();
    return inserted;
  } finally {
    await pool.end();
  }
}
