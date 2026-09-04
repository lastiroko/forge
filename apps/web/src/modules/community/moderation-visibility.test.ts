import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { SESSION_COOKIE, type SessionCookieReader } from '../identity/index.js';
import { getPublishedSolution, listComments, listPublishedSolutions } from './index.js';

const { users, sessions, enrollments, submissions, solutions, comments } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

test('public community queries omit hidden solutions and comments while retaining their rows', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId = '';
  let sessionId = '';
  let enrollmentId = '';
  const submissionIds: string[] = [];
  const solutionIds: string[] = [];
  const commentIds: string[] = [];
  try {
    const [user] = await db.insert(users).values({ githubId: Date.now(), handle: `visibility-${randomUUID()}`, displayName: 'Member', email: `${randomUUID()}@example.com`, role: 'member' }).returning();
    userId = user.id;
    const [session] = await db.insert(sessions).values({ userId, expiresAt: new Date(Date.now() + 60_000) }).returning();
    sessionId = session.id;
    const [enrollment] = await db.insert(enrollments).values({ userId, challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active' }).returning();
    enrollmentId = enrollment.id;
    for (const hidden of [false, true]) {
      const [submission] = await db.insert(submissions).values({ enrollmentId, commitSha: randomUUID(), status: 'graded' }).returning();
      submissionIds.push(submission.id);
      const [solution] = await db.insert(solutions).values({ submissionId: submission.id, title: hidden ? 'Hidden' : 'Visible', writeup: 'Body', publishedAt: new Date(), hiddenAt: hidden ? new Date() : null }).returning();
      solutionIds.push(solution.id);
    }
    for (const hidden of [false, true]) {
      const [comment] = await db.insert(comments).values({ targetType: 'solution', targetId: solutionIds[0], authorId: userId, body: hidden ? 'Hidden comment' : 'Visible comment', hiddenAt: hidden ? new Date() : null }).returning();
      commentIds.push(comment.id);
    }
    const cookieStore: SessionCookieReader = { get: (name) => name === SESSION_COOKIE ? { value: sessionId } : undefined };
    const gallery = await listPublishedSolutions(cookieStore, databaseUrl);
    assert.ok(gallery.some((entry) => entry.id === solutionIds[0]));
    assert.ok(!gallery.some((entry) => entry.id === solutionIds[1]));
    assert.equal(await getPublishedSolution(solutionIds[1], databaseUrl), undefined);
    assert.deepEqual((await listComments({ type: 'solution', id: solutionIds[0] }, databaseUrl)).map((comment) => comment.id), [commentIds[0]]);
    assert.equal((await db.select().from(comments).where(inArray(comments.id, commentIds))).length, 2);
  } finally {
    if (commentIds.length) await db.delete(comments).where(inArray(comments.id, commentIds));
    if (solutionIds.length) await db.delete(solutions).where(inArray(solutions.id, solutionIds));
    if (submissionIds.length) await db.delete(submissions).where(inArray(submissions.id, submissionIds));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});
