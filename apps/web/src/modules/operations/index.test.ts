import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, getQueue, schema } from '@forge/db';
import { AuthorizationError, SESSION_COOKIE, type SessionCookieReader } from '../identity/index.js';
import { GRADING_TOPIC } from '../grading/index.js';
import { cancelGradingRun, getAdminOperations, retryGradingRun } from './index.js';

const { users, sessions, enrollments, submissions, gradingRuns, workerHeartbeats, auditLog } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://forge:forge@postgres:5432/forge';

function cookieStore(sessionId?: string): SessionCookieReader {
  return { get: (name) => name === SESSION_COOKIE && sessionId ? { value: sessionId } : undefined };
}

test('admin operations authorizes callers and returns queue, run, and heartbeat data', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const boss = await getQueue(databaseUrl);
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  const enrollmentId = randomUUID();
  const submissionIds: string[] = [];
  const runIds: string[] = [];
  const workerIds = [randomUUID(), randomUUID()].sort();
  let jobId: string | null = null;
  const now = new Date('2026-01-01T12:00:00.000Z');
  try {
    for (const role of ['member', 'admin'] as const) {
      const [user] = await db.insert(users).values({ githubId: Date.now() + userIds.length, handle: `operations-${role}-${randomUUID()}`, displayName: role, email: `${randomUUID()}@example.com`, role }).returning();
      userIds.push(user.id);
      const [session] = await db.insert(sessions).values({ userId: user.id, expiresAt: new Date(Date.now() + 60_000) }).returning();
      sessionIds.push(session.id);
    }
    await assert.rejects(() => getAdminOperations(cookieStore(sessionIds[0]), databaseUrl, now), AuthorizationError);
    await assert.rejects(() => getAdminOperations(cookieStore(), 'postgres://invalid.invalid/not-opened', now), AuthorizationError);

    await db.insert(enrollments).values({ id: enrollmentId, userId: userIds[1], challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active' });
    for (let index = 0; index < 13; index += 1) {
      const submissionId = randomUUID();
      const runId = randomUUID();
      submissionIds.push(submissionId);
      runIds.push(runId);
      await db.insert(submissions).values({ id: submissionId, enrollmentId, commitSha: `operations-${index}`, status: 'queued' });
      await db.insert(gradingRuns).values({
        id: runId,
        submissionId,
        status: index === 0 ? 'running' : 'failed',
        currentStage: `stage-${index}`,
        updatedAt: new Date(now.getTime() - index * 1_000),
      });
    }
    await db.insert(workerHeartbeats).values([
      { workerId: workerIds[0], startedAt: new Date(now.getTime() - 120_000), lastHeartbeatAt: new Date(now.getTime() - 60_000) },
      { workerId: workerIds[1], startedAt: new Date(now.getTime() - 180_000), lastHeartbeatAt: new Date(now.getTime() - 60_001) },
    ]);

    const before = await getAdminOperations(cookieStore(sessionIds[1]), databaseUrl, now);
    jobId = await boss.send(GRADING_TOPIC, { marker: randomUUID() });
    assert.ok(jobId);
    const result = await getAdminOperations(cookieStore(sessionIds[1]), databaseUrl, now);
    assert.equal(result.queueLength, before.queueLength + 1);
    assert.deepEqual(result.runningRuns.map((run) => run.id), [runIds[0]]);
    assert.equal(result.failedRuns.length, 10);
    assert.deepEqual(result.failedRuns.map((run) => run.id), runIds.slice(1, 11));
    assert.deepEqual(result.workers.map((worker) => [worker.workerId, worker.status]), [
      [workerIds[0], 'healthy'],
      [workerIds[1], 'stale'],
    ]);
  } finally {
    if (jobId) await boss.cancel(jobId);
    await boss.stop();
    await db.delete(workerHeartbeats).where(inArray(workerHeartbeats.workerId, workerIds));
    if (runIds.length) await db.delete(gradingRuns).where(inArray(gradingRuns.id, runIds));
    if (submissionIds.length) await db.delete(submissions).where(inArray(submissions.id, submissionIds));
    await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (sessionIds.length) await db.delete(sessions).where(inArray(sessions.id, sessionIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  }
});

test('retryGradingRun and cancelGradingRun require the admin role, validate run state, and record one audit row per success', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const boss = await getQueue(databaseUrl);
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  const enrollmentId = randomUUID();
  const submissionIds: string[] = [];
  const runIds: string[] = [];
  const auditLogIds: string[] = [];
  let retryJobId: string | null = null;
  let cancelJobId: string | null = null;
  try {
    for (const role of ['member', 'admin'] as const) {
      const [user] = await db.insert(users).values({ githubId: Date.now() + userIds.length, handle: `operations-cmd-${role}-${randomUUID()}`, displayName: role, email: `${randomUUID()}@example.com`, role }).returning();
      userIds.push(user.id);
      const [session] = await db.insert(sessions).values({ userId: user.id, expiresAt: new Date(Date.now() + 60_000) }).returning();
      sessionIds.push(session.id);
    }
    const [, adminUserId] = userIds;
    const [memberSessionId, adminSessionId] = sessionIds;

    await db.insert(enrollments).values({ id: enrollmentId, userId: adminUserId, challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active' });

    const [failedSubmission] = await db.insert(submissions).values({ enrollmentId, commitSha: 'retry-cmd', status: 'failed' }).returning();
    submissionIds.push(failedSubmission.id);
    const [failedRun] = await db.insert(gradingRuns).values({ submissionId: failedSubmission.id, status: 'failed', score: 10 }).returning();
    runIds.push(failedRun.id);

    const [runningSubmission] = await db.insert(submissions).values({ enrollmentId, commitSha: 'cancel-cmd', status: 'running' }).returning();
    submissionIds.push(runningSubmission.id);
    cancelJobId = await boss.send(GRADING_TOPIC, { runId: randomUUID(), submissionId: runningSubmission.id }, { retryLimit: 3 });
    assert.ok(cancelJobId);
    const [runningRun] = await db.insert(gradingRuns).values({
      submissionId: runningSubmission.id, status: 'running', currentStage: 'build', queueJobId: cancelJobId,
    }).returning();
    runIds.push(runningRun.id);

    await assert.rejects(() => retryGradingRun(failedRun.id, cookieStore(), databaseUrl), AuthorizationError);
    await assert.rejects(() => retryGradingRun(failedRun.id, cookieStore(memberSessionId), databaseUrl), AuthorizationError);
    await assert.rejects(() => cancelGradingRun(runningRun.id, cookieStore(), databaseUrl), AuthorizationError);
    await assert.rejects(() => cancelGradingRun(runningRun.id, cookieStore(memberSessionId), databaseUrl), AuthorizationError);

    const auditRowsFor = async (targetId: string) => db.select().from(auditLog).where(eq(auditLog.targetId, targetId));
    assert.equal((await auditRowsFor(failedRun.id)).length, 0);
    assert.equal((await auditRowsFor(runningRun.id)).length, 0);

    await assert.rejects(() => retryGradingRun(runningRun.id, cookieStore(adminSessionId), databaseUrl), /is not failed/);

    let receivedJob: { runId: string; submissionId: string } | undefined;
    await boss.work(GRADING_TOPIC, async (job) => {
      const data = job.data as { runId: string; submissionId: string };
      if (data.submissionId === failedSubmission.id) receivedJob = data;
    });

    await retryGradingRun(failedRun.id, cookieStore(adminSessionId), databaseUrl);
    const deadline = Date.now() + 5_000;
    while (!receivedJob && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(receivedJob?.submissionId, failedSubmission.id);
    assert.equal(receivedJob?.runId, failedRun.id);

    const [retriedRun] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, failedRun.id));
    assert.equal(retriedRun.status, 'queued');
    retryJobId = retriedRun.queueJobId;
    const [retriedSubmission] = await db.select().from(submissions).where(eq(submissions.id, failedSubmission.id));
    assert.equal(retriedSubmission.status, 'queued');

    const retryAuditRows = await auditRowsFor(failedRun.id);
    assert.equal(retryAuditRows.length, 1);
    assert.equal(retryAuditRows[0].actorId, adminUserId);
    assert.equal(retryAuditRows[0].action, 'grading_run.retry');
    assert.equal(retryAuditRows[0].targetType, 'grading_run');
    auditLogIds.push(retryAuditRows[0].id);

    await assert.rejects(() => cancelGradingRun(failedRun.id, cookieStore(adminSessionId), databaseUrl), /is not running/);

    await cancelGradingRun(runningRun.id, cookieStore(adminSessionId), databaseUrl);
    const [cancelledRun] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, runningRun.id));
    assert.equal(cancelledRun.status, 'cancelled');
    const [cancelledSubmission] = await db.select().from(submissions).where(eq(submissions.id, runningSubmission.id));
    assert.equal(cancelledSubmission.status, 'cancelled');
    const cancelledJob = await boss.getJobById(cancelJobId);
    assert.equal(cancelledJob?.state, 'cancelled');

    const cancelAuditRows = await auditRowsFor(runningRun.id);
    assert.equal(cancelAuditRows.length, 1);
    assert.equal(cancelAuditRows[0].actorId, adminUserId);
    assert.equal(cancelAuditRows[0].action, 'grading_run.cancel');
    assert.equal(cancelAuditRows[0].targetType, 'grading_run');
    auditLogIds.push(cancelAuditRows[0].id);
  } finally {
    if (auditLogIds.length) await db.delete(auditLog).where(inArray(auditLog.id, auditLogIds));
    if (retryJobId) await boss.cancel(retryJobId);
    await boss.stop();
    if (runIds.length) await db.delete(gradingRuns).where(inArray(gradingRuns.id, runIds));
    if (submissionIds.length) await db.delete(submissions).where(inArray(submissions.id, submissionIds));
    await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (sessionIds.length) await db.delete(sessions).where(inArray(sessions.id, sessionIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  }
});
