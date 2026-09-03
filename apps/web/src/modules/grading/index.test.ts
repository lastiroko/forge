import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, getQueue, schema } from '@forge/db';
import { cancel, enqueue, GRADING_COMPLETED_TOPIC, GRADING_TOPIC, onRunCompleted, retry } from './index.js';

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
    const receivedJobs: Array<{ runId: string; submissionId: string }> = [];
    let waiters: Array<() => void> = [];
    await boss.work(GRADING_TOPIC, async (job) => {
      const data = job.data as { runId: string; submissionId: string };
      if (data.submissionId !== submission.id) return;
      receivedJobs.push(data);
      const toNotify = waiters;
      waiters = [];
      toNotify.forEach((waiter) => waiter());
    });
    const waitForJobCount = async (count: number) => {
      while (receivedJobs.length < count) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    };

    const run = await enqueue(submission, databaseUrl);
    runId = run.id;
    assert.equal(run.status, 'queued');
    assert.equal(run.score, null);
    assert.ok(run.queueJobId);
    await waitForJobCount(1);
    assert.deepEqual(receivedJobs[0], { runId: run.id, submissionId: submission.id });

    await assert.rejects(() => retry(run.id, databaseUrl), /is not failed/);

    await db.update(gradingRuns).set({ status: 'failed', score: 10, currentStage: 'build' }).where(eq(gradingRuns.id, run.id));
    const reset = await retry(run.id, databaseUrl);
    assert.equal(reset.id, run.id);
    assert.equal(reset.status, 'queued');
    assert.equal(reset.score, null);
    assert.equal(reset.currentStage, null);
    assert.ok(reset.queueJobId);
    assert.notEqual(reset.queueJobId, run.queueJobId);
    await waitForJobCount(2);
    assert.deepEqual(receivedJobs[1], { runId: run.id, submissionId: submission.id });
    const [resetSubmission] = await db.select().from(submissions).where(eq(submissions.id, submission.id));
    assert.equal(resetSubmission.status, 'queued');

    await assert.rejects(() => retry(run.id, databaseUrl), /is not failed/);

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

test('cancel rejects non-running runs and otherwise cancels the queued job and durable state', async () => {
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
    const [submission] = await db.insert(submissions).values({ enrollmentId, commitSha: 'cancel', status: 'queued' }).returning();
    submissionId = submission.id;
    const [run] = await db.insert(gradingRuns).values({ submissionId: submission.id, status: 'queued' }).returning();
    runId = run.id;

    await assert.rejects(() => cancel(run.id, databaseUrl), /is not running/);

    const jobId = await boss.send(GRADING_TOPIC, { runId: run.id, submissionId: submission.id }, { retryLimit: 3 });
    assert.ok(jobId);
    await db.update(gradingRuns).set({ status: 'running', currentStage: 'build', queueJobId: jobId }).where(eq(gradingRuns.id, run.id));

    const cancelled = await cancel(run.id, databaseUrl);
    assert.equal(cancelled.id, run.id);
    assert.equal(cancelled.status, 'cancelled');

    const [cancelledSubmission] = await db.select().from(submissions).where(eq(submissions.id, submission.id));
    assert.equal(cancelledSubmission.status, 'cancelled');

    const cancelledJob = await boss.getJobById(jobId!);
    assert.equal(cancelledJob?.state, 'cancelled');

    await assert.rejects(() => cancel(run.id, databaseUrl), /is not running/);
  } finally {
    if (runId) await db.delete(gradingRuns).where(eq(gradingRuns.id, runId));
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    await boss.stop();
    await pool.end();
  }
});
