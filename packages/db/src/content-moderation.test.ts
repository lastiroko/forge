import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { comments, enrollments, solutions, submissions, users } from './schema.js';

test('moderation timestamps default to null and persist updates', async () => {
  const { db, pool } = createDbClient(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres');
  let userId: string | undefined;
  let enrollmentId: string | undefined;
  let submissionId: string | undefined;
  let solutionId: string | undefined;
  let commentId: string | undefined;
  const moderatedAt = new Date('2026-09-04T12:00:00.000Z');
  try {
    const [user] = await db.insert(users).values({ githubId: Date.now(), handle: `moderation-${randomUUID()}`, displayName: 'Member', email: `${randomUUID()}@example.com`, role: 'member' }).returning();
    userId = user.id;
    const [enrollment] = await db.insert(enrollments).values({ userId, challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active' }).returning();
    enrollmentId = enrollment.id;
    const [submission] = await db.insert(submissions).values({ enrollmentId, commitSha: randomUUID(), status: 'graded' }).returning();
    submissionId = submission.id;
    const [solution] = await db.insert(solutions).values({ submissionId, title: 'Moderate me', writeup: 'Body', publishedAt: new Date() }).returning();
    solutionId = solution.id;
    const [comment] = await db.insert(comments).values({ targetType: 'solution', targetId: solutionId, authorId: userId, body: 'Comment' }).returning();
    commentId = comment.id;
    assert.equal(user.suspendedAt, null);
    assert.equal(solution.hiddenAt, null);
    assert.equal(comment.hiddenAt, null);

    const [updatedUser] = await db.update(users).set({ suspendedAt: moderatedAt }).where(eq(users.id, userId)).returning();
    const [updatedSolution] = await db.update(solutions).set({ hiddenAt: moderatedAt }).where(eq(solutions.id, solutionId)).returning();
    const [updatedComment] = await db.update(comments).set({ hiddenAt: moderatedAt }).where(eq(comments.id, commentId)).returning();
    assert.equal(updatedUser.suspendedAt?.toISOString(), moderatedAt.toISOString());
    assert.equal(updatedSolution.hiddenAt?.toISOString(), moderatedAt.toISOString());
    assert.equal(updatedComment.hiddenAt?.toISOString(), moderatedAt.toISOString());
  } finally {
    if (commentId) await db.delete(comments).where(eq(comments.id, commentId));
    if (solutionId) await db.delete(solutions).where(eq(solutions.id, solutionId));
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});
