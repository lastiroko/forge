import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, enrollments, submissions } from '@forge/db';
import { submit, getSubmission, MOCKED_DEFAULT_BRANCH_HEAD_SHA } from './index.js';

const repoUrl = 'https://github.com/example/repo';

test('submit with an explicit SHA stores exactly that SHA', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  let enrollmentId;
  let submissionId;
  try {
    const [insertedEnrollment] = await db
      .insert(enrollments)
      .values({ userId: randomUUID(), challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'pending', repoUrl })
      .returning();
    enrollmentId = insertedEnrollment.id;

    const submission = await submit({ id: enrollmentId, repoUrl }, 'abc123');
    submissionId = submission.id;

    assert.equal(submission.commitSha, 'abc123');
    assert.equal(submission.enrollmentId, enrollmentId);
  } finally {
    if (submissionId) {
      await db.delete(submissions).where(eq(submissions.id, submissionId));
    }
    if (enrollmentId) {
      await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    }
    await pool.end();
  }
});

test('submit with no SHA stores the mocked default-branch head SHA', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  let enrollmentId;
  let submissionId;
  try {
    const [insertedEnrollment] = await db
      .insert(enrollments)
      .values({ userId: randomUUID(), challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'pending', repoUrl })
      .returning();
    enrollmentId = insertedEnrollment.id;

    const submission = await submit({ id: enrollmentId, repoUrl });
    submissionId = submission.id;

    assert.equal(submission.commitSha, MOCKED_DEFAULT_BRANCH_HEAD_SHA);
  } finally {
    if (submissionId) {
      await db.delete(submissions).where(eq(submissions.id, submissionId));
    }
    if (enrollmentId) {
      await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    }
    await pool.end();
  }
});

test('getSubmission returns a previously stored submission', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  let enrollmentId;
  let submissionId;
  try {
    const [insertedEnrollment] = await db
      .insert(enrollments)
      .values({ userId: randomUUID(), challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'pending', repoUrl })
      .returning();
    enrollmentId = insertedEnrollment.id;

    const inserted = await submit({ id: enrollmentId, repoUrl }, 'def456');
    submissionId = inserted.id;

    const fetched = await getSubmission(submissionId);

    assert.ok(fetched);
    assert.equal(fetched.id, inserted.id);
    assert.equal(fetched.enrollmentId, inserted.enrollmentId);
    assert.equal(fetched.commitSha, inserted.commitSha);
    assert.equal(fetched.status, inserted.status);
  } finally {
    if (submissionId) {
      await db.delete(submissions).where(eq(submissions.id, submissionId));
    }
    if (enrollmentId) {
      await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    }
    await pool.end();
  }
});
