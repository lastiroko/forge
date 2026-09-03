import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, getQueue, schema } from '@forge/db';
import { enqueue, GRADING_COMPLETED_TOPIC, GRADING_TOPIC, onRunCompleted, retry } from './index.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

const { enrollments, submissions, gradingRuns } = schema;

test('enqueue creates a queued run and publishes matching identifiers', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const boss = await getQueue(databaseUrl);
  let enrollmentId: string | undefined;
  let submissionId: string | undefined;
  let runId: string | undefined;
  try {
    const [enrollment] = await db.insert(enrollments).values({
      userId: randomUUID(), challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active',
    }).returning();
    enrollmentId = enrollment.id;
    const [submission] = await db.insert(submissions).values({ enrollmentId, commitSha: 'enqueue', status: 'queued' }).returning();
    submissionId = submission.id;
    let resolveReceived!: (data: { runId: string; submissionId: string }) => void;
    const received = new Promise<{ runId: string; submissionId: string }>((resolve) => { resolveReceived = resolve; });
    await boss.work(GRADING_TOPIC, async (job) => {
      const data = job.data as { runId: string; submissionId: string };
      if (data.submissionId === submission.id) resolveReceived(data);
    });
    const run = await enqueue(submission, databaseUrl);
    runId = run.id;
    assert.equal(run.status, 'queued');
    assert.equal(run.score, null);
    assert.deepEqual(await received, { runId: run.id, submissionId: submission.id });

    await db.update(gradingRuns).set({ status: 'failed', score: 10, currentStage: 'build' }).where(eq(gradingRuns.id, run.id));
    const reset = await retry(run.id, databaseUrl);
    assert.equal(reset.id, run.id);
    assert.equal(reset.status, 'queued');
    assert.equal(reset.score, null);
    assert.equal(reset.currentStage, null);

    const calls: Array<{ handler: string; id: string; score: number }> = [];
    const stopFirst = await onRunCompleted((completed) => {
      calls.push({ handler: 'first', ...completed });
    }, databaseUrl);
    const stopSecond = await onRunCompleted((completed) => {
      calls.push({ handler: 'second', ...completed });
    }, databaseUrl);
    await db.update(gradingRuns).set({ status: 'successful', score: 92 }).where(eq(gradingRuns.id, run.id));
    await boss.send(GRADING_COMPLETED_TOPIC, { id: run.id, score: 92 });
    await boss.send(GRADING_COMPLETED_TOPIC, { id: run.id, score: 92 });
    const deadline = Date.now() + 5_000;
    while (calls.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(calls, [
      { handler: 'first', id: run.id, score: 92 },
      { handler: 'second', id: run.id, score: 92 },
    ]);
    await stopFirst();
    await stopSecond();
  } finally {
    if (runId) await db.delete(gradingRuns).where(eq(gradingRuns.id, runId));
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    await boss.stop();
    await pool.end();
  }
});
