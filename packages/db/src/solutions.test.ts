import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { users, enrollments, submissions, solutions, comments } from './schema.js';

test('publishes a solution linked to a completed submission and comments on it', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  let insertedUser;
  let insertedEnrollment;
  let insertedSubmission;
  let insertedSolution;
  let insertedComment;
  try {
    [insertedUser] = await db
      .insert(users)
      .values({
        githubId: 57001,
        handle: 'solution-author',
        displayName: 'Solution Author',
        email: 'solution-author@example.com',
        role: 'member',
      })
      .returning();

    [insertedEnrollment] = await db
      .insert(enrollments)
      .values({
        userId: insertedUser.id,
        challengeVersionId: randomUUID(),
        mode: 'backend',
        stackId: randomUUID(),
        status: 'active',
      })
      .returning();

    [insertedSubmission] = await db
      .insert(submissions)
      .values({ enrollmentId: insertedEnrollment.id, commitSha: 'def456', status: 'graded' })
      .returning();

    [insertedSolution] = await db
      .insert(solutions)
      .values({
        submissionId: insertedSubmission.id,
        title: 'My solution',
        writeup: 'How I built it',
        publishedAt: new Date(),
      })
      .returning();

    [insertedComment] = await db
      .insert(comments)
      .values({
        targetType: 'solution',
        targetId: insertedSolution.id,
        authorId: insertedUser.id,
        body: 'Nice work',
      })
      .returning();

    const [solutionRow] = await db.select().from(solutions).where(eq(solutions.id, insertedSolution.id));
    const [commentRow] = await db.select().from(comments).where(eq(comments.id, insertedComment.id));

    assert.equal(solutionRow.submissionId, insertedSubmission.id);
    assert.equal(solutionRow.title, 'My solution');
    assert.equal(solutionRow.writeup, 'How I built it');
    assert.notEqual(solutionRow.publishedAt, null);
    assert.equal(commentRow.targetType, 'solution');
    assert.equal(commentRow.targetId, insertedSolution.id);
    assert.equal(commentRow.authorId, insertedUser.id);
    assert.equal(commentRow.body, 'Nice work');
  } finally {
    if (insertedComment) {
      await db.delete(comments).where(eq(comments.id, insertedComment.id));
    }
    if (insertedSolution) {
      await db.delete(solutions).where(eq(solutions.id, insertedSolution.id));
    }
    if (insertedSubmission) {
      await db.delete(submissions).where(eq(submissions.id, insertedSubmission.id));
    }
    if (insertedEnrollment) {
      await db.delete(enrollments).where(eq(enrollments.id, insertedEnrollment.id));
    }
    if (insertedUser) {
      await db.delete(users).where(eq(users.id, insertedUser.id));
    }
    await pool.end();
  }
});
