import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { award } from './index.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const { challenges, challengeVersions, enrollments, gradingRuns, pointsLedger, stacks, submissions } = schema;

async function withRun(score: number, verify: (fixture: {
  runId: string;
  userId: string;
  stackId: string;
}) => Promise<void>): Promise<void> {
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId: string | undefined;
  let challengeVersionId: string | undefined;
  let stackId: string | undefined;
  let enrollmentId: string | undefined;
  let submissionId: string | undefined;
  let runId: string | undefined;
  const userId = randomUUID();

  try {
    const [challenge] = await db.insert(challenges).values({ title: `Scoring ${score}`, level: 'junior' }).returning();
    challengeId = challenge.id;
    const [version] = await db.insert(challengeVersions).values({
      challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'scoring', hiddenTestsRef: 'scoring',
    }).returning();
    challengeVersionId = version.id;
    const [stack] = await db.insert(stacks).values({ language: 'typescript', framework: `scoring-${randomUUID()}` }).returning();
    stackId = stack.id;
    const [enrollment] = await db.insert(enrollments).values({
      userId, challengeVersionId, mode: 'backend', stackId, status: 'active',
    }).returning();
    enrollmentId = enrollment.id;
    const [submission] = await db.insert(submissions).values({
      enrollmentId, commitSha: randomUUID(), status: 'completed',
    }).returning();
    submissionId = submission.id;
    const [run] = await db.insert(gradingRuns).values({ submissionId, status: 'successful', score }).returning();
    runId = run.id;

    await verify({ runId, userId, stackId });
  } finally {
    if (runId) await db.delete(pointsLedger).where(eq(pointsLedger.gradingRunId, runId));
    if (runId) await db.delete(gradingRuns).where(eq(gradingRuns.id, runId));
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (challengeVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, challengeVersionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    if (stackId) await db.delete(stacks).where(eq(stacks.id, stackId));
    await pool.end();
  }
}

test('award inserts one junior completion award at 85 percent and remains idempotent', async () => {
  await withRun(85, async ({ runId, userId, stackId }) => {
    await award({ id: runId, score: 85 }, databaseUrl);
    await award({ id: runId, score: 85 }, databaseUrl);

    const { db, pool } = createDbClient(databaseUrl);
    try {
      const rows = await db.select().from(pointsLedger).where(eq(pointsLedger.gradingRunId, runId));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].delta, 85);
      assert.equal(rows[0].reason, 'challenge_completed');
      assert.equal(rows[0].userId, userId);
      assert.equal(rows[0].stackId, stackId);
      assert.equal(rows[0].gradingRunId, runId);
    } finally {
      await pool.end();
    }
  });
});

test('award inserts no ledger row below 70 percent', async () => {
  await withRun(50, async ({ runId }) => {
    await award({ id: runId, score: 50 }, databaseUrl);

    const { db, pool } = createDbClient(databaseUrl);
    try {
      const rows = await db.select().from(pointsLedger).where(eq(pointsLedger.gradingRunId, runId));
      assert.equal(rows.length, 0);
    } finally {
      await pool.end();
    }
  });
});
