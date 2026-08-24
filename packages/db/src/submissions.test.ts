import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { enrollments, submissions } from './schema.js';

test('inserts a submission linked to an enrollment and reads it back', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const challengeVersionId = randomUUID();
  const stackId = randomUUID();
  let insertedEnrollmentId;
  let insertedSubmissionId;
  try {
    const [insertedEnrollment] = await db
      .insert(enrollments)
      .values({ userId, challengeVersionId, mode: 'backend', stackId, status: 'pending' })
      .returning();
    insertedEnrollmentId = insertedEnrollment.id;

    const [insertedSubmission] = await db
      .insert(submissions)
      .values({ enrollmentId: insertedEnrollmentId, commitSha: 'abc123', status: 'queued' })
      .returning();
    insertedSubmissionId = insertedSubmission.id;

    const [row] = await db.select().from(submissions).where(eq(submissions.id, insertedSubmissionId));

    assert.equal(row.enrollmentId, insertedEnrollmentId);
    assert.equal(row.commitSha, 'abc123');
    assert.equal(row.status, 'queued');
  } finally {
    if (insertedSubmissionId) {
      await db.delete(submissions).where(eq(submissions.id, insertedSubmissionId));
    }
    if (insertedEnrollmentId) {
      await db.delete(enrollments).where(eq(enrollments.id, insertedEnrollmentId));
    }
    await pool.end();
  }
});
