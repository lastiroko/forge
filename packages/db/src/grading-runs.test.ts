import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { enrollments, gradingRuns, submissions } from './schema.js';

test('persists a queued grading run and its lifecycle fields', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  let enrollmentId: string | undefined;
  let submissionId: string | undefined;
  let gradingRunId: string | undefined;
  try {
    const [enrollment] = await db.insert(enrollments).values({
      userId: randomUUID(), challengeVersionId: randomUUID(), mode: 'backend',
      stackId: randomUUID(), status: 'completed',
    }).returning();
    enrollmentId = enrollment.id;
    const [submission] = await db.insert(submissions).values({
      enrollmentId, commitSha: 'fractional-score', status: 'graded',
    }).returning();
    submissionId = submission.id;
    const [run] = await db.insert(gradingRuns).values({ submissionId, status: 'queued' }).returning();
    gradingRunId = run.id;

    const completionTime = new Date();
    await db.update(gradingRuns).set({
      status: 'successful', currentStage: 'functional', score: 87.5,
      updatedAt: completionTime, completionEventSentAt: completionTime,
    }).where(eq(gradingRuns.id, gradingRunId));

    const [stored] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, gradingRunId));
    assert.equal(stored.status, 'successful');
    assert.equal(stored.score, 87.5);
    assert.equal(typeof stored.score, 'number');
    assert.equal(stored.currentStage, 'functional');
    assert.equal(stored.updatedAt.getTime(), completionTime.getTime());
    assert.equal(stored.completionEventSentAt?.getTime(), completionTime.getTime());
    await assert.rejects(
      db.insert(gradingRuns).values({ submissionId: randomUUID(), status: 'queued' }),
      /foreign key/i,
    );
  } finally {
    if (gradingRunId) await db.delete(gradingRuns).where(eq(gradingRuns.id, gradingRunId));
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    await pool.end();
  }
});
