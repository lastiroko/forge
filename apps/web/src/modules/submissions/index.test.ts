import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { submit, RateLimitExceededError } from './index.js';

const { challenges, challengeVersions, enrollments, submissions } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

test('rejects a sixth submission for the same member and challenge within the rolling hour, but allows one for a different challenge', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const stackId = randomUUID();
  const insertedSubmissionIds: string[] = [];
  let enrollmentAId: string | undefined;
  let enrollmentBId: string | undefined;
  let versionAId: string | undefined;
  let versionBId: string | undefined;
  let challengeAId: string | undefined;
  let challengeBId: string | undefined;

  try {
    const [challengeA] = await db.insert(challenges).values({ title: 'Challenge A', level: 'junior' }).returning();
    challengeAId = challengeA.id;
    const [versionA] = await db
      .insert(challengeVersions)
      .values({ challengeId: challengeAId, version: 1, level: 'junior', rubric: {}, openapiRef: 'a', hiddenTestsRef: 'a' })
      .returning();
    versionAId = versionA.id;

    const [challengeB] = await db.insert(challenges).values({ title: 'Challenge B', level: 'junior' }).returning();
    challengeBId = challengeB.id;
    const [versionB] = await db
      .insert(challengeVersions)
      .values({ challengeId: challengeBId, version: 1, level: 'junior', rubric: {}, openapiRef: 'b', hiddenTestsRef: 'b' })
      .returning();
    versionBId = versionB.id;

    const [enrollmentA] = await db
      .insert(enrollments)
      .values({ userId, challengeVersionId: versionAId, mode: 'backend', stackId, status: 'active' })
      .returning();
    enrollmentAId = enrollmentA.id;

    const [enrollmentB] = await db
      .insert(enrollments)
      .values({ userId, challengeVersionId: versionBId, mode: 'backend', stackId, status: 'active' })
      .returning();
    enrollmentBId = enrollmentB.id;

    for (let i = 0; i < 5; i++) {
      const submission = await submit(enrollmentAId, `sha-${i}`, databaseUrl);
      insertedSubmissionIds.push(submission.id);
      assert.equal(submission.status, 'queued');
    }

    await assert.rejects(
      () => submit(enrollmentAId!, 'sha-6', databaseUrl),
      (error) => {
        assert.ok(error instanceof RateLimitExceededError);
        assert.ok(error.retryAfterSeconds > 0);
        assert.ok(error.retryAfterSeconds <= 3600);
        assert.match(error.message, /retry after/i);
        return true;
      },
    );

    const seventh = await submit(enrollmentBId, 'sha-7', databaseUrl);
    insertedSubmissionIds.push(seventh.id);
    assert.equal(seventh.status, 'queued');
  } finally {
    if (insertedSubmissionIds.length) {
      await db.delete(submissions).where(inArray(submissions.id, insertedSubmissionIds));
    }
    if (enrollmentAId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentAId));
    if (enrollmentBId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentBId));
    if (versionAId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionAId));
    if (versionBId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionBId));
    if (challengeAId) await db.delete(challenges).where(eq(challenges.id, challengeAId));
    if (challengeBId) await db.delete(challenges).where(eq(challenges.id, challengeBId));
    await pool.end();
  }
});
