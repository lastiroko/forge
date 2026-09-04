import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { createDbClient, getQueue, schema } from '@forge/db';
import { createServer, GRADING_COMPLETED_TOPIC, registerWorker, startWorkerHeartbeat } from './server.js';

const { enrollments, submissions, gradingRuns, workerHeartbeats } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://forge:forge@postgres:5432/forge';

test('GET /health returns 200 with {"status":"ok"}', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    const body = await res.json();
    assert.deepEqual(body, { status: 'ok' });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('unknown route returns 404', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.deepEqual(body, { error: 'not found' });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('worker heartbeat lifecycle persists heartbeats until cleanup', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const workerId = randomUUID();
  const stopHeartbeat = startWorkerHeartbeat(databaseUrl, 20, workerId);
  try {
    let initial: typeof workerHeartbeats.$inferSelect | undefined;
    for (let attempt = 0; attempt < 50 && !initial; attempt += 1) {
      [initial] = await db.select().from(workerHeartbeats).where(eq(workerHeartbeats.workerId, workerId));
      if (!initial) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(initial);

    let advanced: typeof workerHeartbeats.$inferSelect | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      [advanced] = await db.select().from(workerHeartbeats).where(eq(workerHeartbeats.workerId, workerId));
      if (advanced && advanced.lastHeartbeatAt.getTime() > initial.lastHeartbeatAt.getTime()) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(advanced);
    assert.ok(advanced.lastHeartbeatAt.getTime() > initial.lastHeartbeatAt.getTime());

    await stopHeartbeat();
    const stoppedAt = advanced.lastHeartbeatAt.getTime();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [afterCleanup] = await db.select().from(workerHeartbeats).where(eq(workerHeartbeats.workerId, workerId));
    assert.equal(afterCleanup.lastHeartbeatAt.getTime(), stoppedAt);
  } finally {
    await stopHeartbeat();
    await db.delete(workerHeartbeats).where(eq(workerHeartbeats.workerId, workerId));
    await pool.end();
  }
});

test('registered worker persists supplied stage completion before publishing it', async () => {
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
    const [submission] = await db.insert(submissions).values({ enrollmentId, commitSha: 'worker', status: 'queued' }).returning();
    submissionId = submission.id;
    const [run] = await db.insert(gradingRuns).values({ submissionId, status: 'queued' }).returning();
    runId = run.id;

    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    await boss.work(GRADING_COMPLETED_TOPIC, async (job) => {
      const data = job.data as { id: string; score: number };
      if (data.id !== run.id) return;
      const [stored] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, run.id));
      assert.equal(stored.status, 'successful');
      assert.equal(stored.score, 94);
      assert.equal(stored.reportUrl, 'https://reports.example/run');
      assert.equal(stored.buildLogUrl, 'https://logs.example/build');
      assert.equal(stored.appLogUrl, 'https://logs.example/app');
      const [owner] = await db.select().from(enrollments).where(eq(enrollments.id, enrollment.id));
      assert.equal(owner.bestGradingRunId, run.id);
      resolveCompletion();
    });
    await registerWorker(boss, [{
      name: 'report',
      run: async () => ({
        outcome: 'passed', score: 94, reportUrl: 'https://reports.example/run',
        buildLogUrl: 'https://logs.example/build', appLogUrl: 'https://logs.example/app',
      }),
    }], databaseUrl);
    await boss.send('grading', { runId: run.id, submissionId: submission.id });
    await Promise.race([
      completion,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('completion was not published')), 10_000)),
    ]);
  } finally {
    if (enrollmentId) await db.update(enrollments).set({ bestGradingRunId: null }).where(eq(enrollments.id, enrollmentId));
    if (runId) await db.delete(gradingRuns).where(eq(gradingRuns.id, runId));
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    await boss.stop();
    await pool.end();
  }
});

test('cancelled run rejects later worker status and completion overwrites', async () => {
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
    const [submission] = await db.insert(submissions).values({ enrollmentId, commitSha: 'worker-cancel', status: 'running' }).returning();
    submissionId = submission.id;
    const [run] = await db.insert(gradingRuns).values({ submissionId, status: 'running', currentStage: 'build' }).returning();
    runId = run.id;

    let completionReceived = false;
    await boss.work(GRADING_COMPLETED_TOPIC, async (job) => {
      const data = job.data as { id: string };
      if (data.id === run.id) completionReceived = true;
    });

    let stageRan!: () => void;
    const stageRanPromise = new Promise<void>((resolve) => { stageRan = resolve; });

    await registerWorker(boss, [{
      name: 'report',
      run: async () => {
        await db.update(gradingRuns).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(gradingRuns.id, run.id));
        await db.update(submissions).set({ status: 'cancelled' }).where(eq(submissions.id, submission.id));
        stageRan();
        return {
          outcome: 'passed', score: 94, reportUrl: 'https://reports.example/run',
          buildLogUrl: 'https://logs.example/build', appLogUrl: 'https://logs.example/app',
        };
      },
    }], databaseUrl);
    await boss.send('grading', { runId: run.id, submissionId: submission.id });
    await stageRanPromise;
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [storedRun] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, run.id));
    assert.equal(storedRun.status, 'cancelled');
    assert.equal(storedRun.score, null);
    const [storedSubmission] = await db.select().from(submissions).where(eq(submissions.id, submission.id));
    assert.equal(storedSubmission.status, 'cancelled');
    assert.equal(completionReceived, false);
  } finally {
    if (runId) await db.delete(gradingRuns).where(eq(gradingRuns.id, runId));
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    await boss.stop();
    await pool.end();
  }
});

test('registered worker keeps the 90-point run as best regardless of completion order', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const boss = await getQueue(databaseUrl);
  const enrollmentIds: string[] = [];
  const submissionIds: string[] = [];
  const runIds: string[] = [];
  const scoreByRun = new Map<string, number>();
  const expectedBest = new Map<string, string>();
  try {
    const completionOrders = [[40, 90], [90, 40]];
    const jobs: Array<{ runId: string; submissionId: string }> = [];
    for (const scores of completionOrders) {
      const [enrollment] = await db.insert(enrollments).values({
        userId: randomUUID(), challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active',
      }).returning();
      enrollmentIds.push(enrollment.id);
      for (const score of scores) {
        const [submission] = await db.insert(submissions).values({ enrollmentId: enrollment.id, commitSha: `worker-${score}-${randomUUID()}`, status: 'queued' }).returning();
        submissionIds.push(submission.id);
        const [run] = await db.insert(gradingRuns).values({ submissionId: submission.id, status: 'queued' }).returning();
        runIds.push(run.id);
        scoreByRun.set(run.id, score);
        jobs.push({ runId: run.id, submissionId: submission.id });
        if (score === 90) expectedBest.set(enrollment.id, run.id);
      }
    }

    const completionResolvers = new Map<string, () => void>();
    await boss.work(GRADING_COMPLETED_TOPIC, async (job) => {
      const { id } = job.data as { id: string };
      completionResolvers.get(id)?.();
    });
    await registerWorker(boss, [{
      name: 'report',
      run: async (job) => {
        const score = scoreByRun.get(job.data.runId);
        if (score === undefined) throw new Error(`missing score for run ${job.data.runId}`);
        return {
          outcome: 'passed' as const,
          score,
          reportUrl: `https://reports.example/${job.data.runId}`,
          buildLogUrl: `https://logs.example/${job.data.runId}/build`,
          appLogUrl: `https://logs.example/${job.data.runId}/app`,
        };
      },
    }], databaseUrl);
    for (const job of jobs) {
      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
      completionResolvers.set(job.runId, resolveCompletion);
      await boss.send('grading', job);
      await Promise.race([
        completion,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`completion for ${job.runId} was not published`)), 10_000)),
      ]);
    }

    for (const enrollmentId of enrollmentIds) {
      const [enrollment] = await db.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
      assert.equal(enrollment.bestGradingRunId, expectedBest.get(enrollmentId));
    }
    for (const runId of runIds) {
      const [run] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, runId));
      assert.equal(run.score, scoreByRun.get(runId));
      assert.equal(run.reportUrl, `https://reports.example/${runId}`);
      assert.equal(run.buildLogUrl, `https://logs.example/${runId}/build`);
      assert.equal(run.appLogUrl, `https://logs.example/${runId}/app`);
    }
  } finally {
    for (const id of enrollmentIds) await db.update(enrollments).set({ bestGradingRunId: null }).where(eq(enrollments.id, id));
    for (const id of runIds) await db.delete(gradingRuns).where(eq(gradingRuns.id, id));
    for (const id of submissionIds) await db.delete(submissions).where(eq(submissions.id, id));
    for (const id of enrollmentIds) await db.delete(enrollments).where(eq(enrollments.id, id));
    await boss.stop();
    await pool.end();
  }
});
