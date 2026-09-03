import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { enrollments, gradingRuns, submissions } from './schema.js';

test('persists grading run status and fractional score', async () => {
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
    const [run] = await db.insert(gradingRuns).values({
      submissionId, status: 'successful', score: 87.5, reportUrl: null,
    }).returning();
    gradingRunId = run.id;

    const [stored] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, gradingRunId));
    assert.equal(stored.status, 'successful');
    assert.equal(stored.score, 87.5);
    assert.equal(typeof stored.score, 'number');
  } finally {
    if (gradingRunId) await db.delete(gradingRuns).where(eq(gradingRuns.id, gradingRunId));
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    await pool.end();
  }
});
