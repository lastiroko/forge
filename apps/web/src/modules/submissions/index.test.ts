import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, enrollments, submissions, type Db } from '@forge/db';
import { submit, getSubmission, MOCKED_DEFAULT_BRANCH_HEAD_SHA } from './index.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const repoUrl = 'https://github.com/example/repo';

async function insertEnrollment(db: Db) {
  const [enrollment] = await db
    .insert(enrollments)
    .values({
      userId: randomUUID(),
      challengeVersionId: randomUUID(),
      mode: 'backend',
      stackId: randomUUID(),
      status: 'pending',
      repoUrl,
    })
    .returning();
  return enrollment.id;
}

test('submit with an explicit SHA stores exactly that SHA', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let enrollmentId;
  let submissionId;
  try {
    enrollmentId = await insertEnrollment(db);

    const result = await submit({ id: enrollmentId, repoUrl }, 'abc123');
    submissionId = result.id;

    assert.equal(result.commitSha, 'abc123');
    assert.equal(result.enrollmentId, enrollmentId);
  } finally {
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    await pool.end();
  }
});

test('submit with no SHA stores the mocked default-branch head SHA', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let enrollmentId;
  let submissionId;
  try {
    enrollmentId = await insertEnrollment(db);

    const result = await submit({ id: enrollmentId, repoUrl });
    submissionId = result.id;

    assert.equal(result.commitSha, MOCKED_DEFAULT_BRANCH_HEAD_SHA);
  } finally {
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    await pool.end();
  }
});

test('getSubmission returns a previously stored submission', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let enrollmentId;
  let submissionId;
  try {
    enrollmentId = await insertEnrollment(db);

    const inserted = await submit({ id: enrollmentId, repoUrl }, 'def456');
    submissionId = inserted.id;

    const result = await getSubmission(submissionId);

    assert.equal(result?.id, submissionId);
    assert.equal(result?.enrollmentId, enrollmentId);
    assert.equal(result?.commitSha, 'def456');
    assert.equal(result?.status, 'queued');
  } finally {
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    await pool.end();
  }
});
