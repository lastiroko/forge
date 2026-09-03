import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { createDbClient, getQueue, schema } from '@forge/db';
import { createServer, GRADING_COMPLETED_TOPIC, registerWorker } from './server.js';

const { enrollments, submissions, gradingRuns } = schema;
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
