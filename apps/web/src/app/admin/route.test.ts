import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, getQueue, schema } from '@forge/db';
import { GRADING_TOPIC } from '../../modules/grading/index.js';
import { SESSION_COOKIE } from '../../modules/identity/index.js';

const { users, sessions, enrollments, submissions, gradingRuns, workerHeartbeats, auditLog } = schema;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3466;
const { db, pool } = createDbClient(databaseUrl);
let boss: Awaited<ReturnType<typeof getQueue>>;
const ids = { users: [] as string[], sessions: [] as string[], submissions: [] as string[], runs: [] as string[] };
const enrollmentId = randomUUID();
const workerId = randomUUID();
let adminUserId: string;
let adminSessionId: string;
let memberSessionId: string;
let server: ChildProcess | undefined;
let jobId: string | null = null;

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await fetch(url); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`server at ${url} did not become ready`);
}

function queueLength(html: string): number {
  const match = html.match(/<output data-queue-length>(\d+)<\/output>/);
  assert.ok(match, 'expected queue length output');
  return Number(match[1]);
}

before(async () => {
  boss = await getQueue(databaseUrl);
  const seededUsers = await db.insert(users).values((['admin', 'member'] as const).map((role) => ({
    githubId: Math.floor(Math.random() * 1_000_000_000),
    handle: `admin-route-${role}-${randomUUID()}`,
    displayName: role,
    email: `${randomUUID()}@example.com`,
    role,
  }))).returning();
  ids.users.push(...seededUsers.map((user) => user.id));
  const seededSessions = await db.insert(sessions).values(seededUsers.map((user) => ({
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  }))).returning();
  ids.sessions.push(...seededSessions.map((session) => session.id));
  [adminSessionId, memberSessionId] = seededSessions.map((session) => session.id);
  adminUserId = seededUsers[0].id;

  await db.insert(enrollments).values({ id: enrollmentId, userId: seededUsers[0].id, challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active' });
  for (const fixture of [
    { status: 'running', stage: 'seeded-running-stage' },
    { status: 'failed', stage: 'seeded-failed-stage' },
  ]) {
    const submissionId = randomUUID();
    const runId = randomUUID();
    ids.submissions.push(submissionId);
    ids.runs.push(runId);
    await db.insert(submissions).values({ id: submissionId, enrollmentId, commitSha: randomUUID(), status: fixture.status });
    await db.insert(gradingRuns).values({ id: runId, submissionId, status: fixture.status, currentStage: fixture.stage });
  }
  await db.insert(workerHeartbeats).values({ workerId });

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });
  server = spawn('node', ['.next/standalone/apps/web/server.js'], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' },
  });
  await waitForServer(`http://127.0.0.1:${port}/`);
});

after(async () => {
  if (server) server.kill();
  if (jobId) await boss.cancel(jobId);
  await boss.stop();
  await db.delete(workerHeartbeats).where(eq(workerHeartbeats.workerId, workerId));
  if (ids.runs.length) await db.delete(gradingRuns).where(inArray(gradingRuns.id, ids.runs));
  if (ids.submissions.length) await db.delete(submissions).where(inArray(submissions.id, ids.submissions));
  await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
  if (ids.sessions.length) await db.delete(sessions).where(inArray(sessions.id, ids.sessions));
  if (ids.users.length) await db.delete(users).where(inArray(users.id, ids.users));
  await pool.end();
});

test('GET /admin returns 403 to member and anonymous callers', async () => {
  const member = await fetch(`http://127.0.0.1:${port}/admin`, { headers: { Cookie: `${SESSION_COOKIE}=${memberSessionId}` } });
  assert.equal(member.status, 403);
  const anonymous = await fetch(`http://127.0.0.1:${port}/admin`);
  assert.equal(anonymous.status, 403);
});

test('GET /admin renders read-only operational data and the exact queue growth', async () => {
  const headers = { Cookie: `${SESSION_COOKIE}=${adminSessionId}` };
  const beforeResponse = await fetch(`http://127.0.0.1:${port}/admin`, { headers });
  const beforeHtml = await beforeResponse.text();
  assert.equal(beforeResponse.status, 200);

  jobId = await boss.send(GRADING_TOPIC, { marker: randomUUID() });
  assert.ok(jobId);
  const afterResponse = await fetch(`http://127.0.0.1:${port}/admin`, { headers });
  const html = await afterResponse.text();
  assert.equal(afterResponse.status, 200);
  assert.match(afterResponse.headers.get('content-type') ?? '', /^text\/html/);
  assert.equal(queueLength(html), queueLength(beforeHtml) + 1);
  assert.match(html, new RegExp(ids.runs[0]));
  assert.match(html, new RegExp(ids.submissions[0]));
  assert.match(html, /seeded-running-stage/);
  assert.match(html, new RegExp(workerId));
  assert.match(html, new RegExp(ids.runs[1]));
  assert.match(html, /seeded-failed-stage/);
  assert.doesNotMatch(html, /secret|configuration/i);
  assert.match(html, new RegExp(`name="runId" value="${ids.runs[0]}"[\\s\\S]*?name="action" value="cancel"`));
  assert.match(html, new RegExp(`name="runId" value="${ids.runs[1]}"[\\s\\S]*?name="action" value="retry"`));
  assert.doesNotMatch(html, new RegExp(`name="runId" value="${ids.runs[0]}"[\\s\\S]*?name="action" value="retry"`));
  assert.doesNotMatch(html, new RegExp(`name="runId" value="${ids.runs[1]}"[\\s\\S]*?name="action" value="cancel"`));
});

test('POST /admin returns 403 to member and anonymous callers without mutating state', async () => {
  const runId = ids.runs[1];
  const body = new URLSearchParams({ action: 'retry', runId });

  const anonymous = await fetch(`http://127.0.0.1:${port}/admin`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  assert.equal(anonymous.status, 403);

  const member = await fetch(`http://127.0.0.1:${port}/admin`, {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: `${SESSION_COOKIE}=${memberSessionId}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  assert.equal(member.status, 403);

  const [run] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, runId));
  assert.equal(run.status, 'failed');
  const auditRows = await db.select().from(auditLog).where(eq(auditLog.targetId, runId));
  assert.equal(auditRows.length, 0);
});

test('POST /admin rejects malformed action or missing runId with 400', async () => {
  const headers = { Cookie: `${SESSION_COOKIE}=${adminSessionId}`, 'Content-Type': 'application/x-www-form-urlencoded' };

  const badAction = await fetch(`http://127.0.0.1:${port}/admin`, {
    method: 'POST', redirect: 'manual', headers, body: new URLSearchParams({ action: 'delete', runId: ids.runs[1] }),
  });
  assert.equal(badAction.status, 400);

  const missingRunId = await fetch(`http://127.0.0.1:${port}/admin`, {
    method: 'POST', redirect: 'manual', headers, body: new URLSearchParams({ action: 'retry' }),
  });
  assert.equal(missingRunId.status, 400);
});

test('POST /admin retry re-enqueues a failed run and records one audit row naming the admin', async () => {
  const headers = { Cookie: `${SESSION_COOKIE}=${adminSessionId}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  const submissionId = randomUUID();
  const runId = randomUUID();
  let queueJobId: string | null = null;
  try {
    await db.insert(submissions).values({ id: submissionId, enrollmentId, commitSha: randomUUID(), status: 'failed' });
    await db.insert(gradingRuns).values({ id: runId, submissionId, status: 'failed', score: 5 });

    let receivedJob: { runId: string; submissionId: string } | undefined;
    await boss.work(GRADING_TOPIC, async (job) => {
      const data = job.data as { runId: string; submissionId: string };
      if (data.submissionId === submissionId) receivedJob = data;
    });

    const response = await fetch(`http://127.0.0.1:${port}/admin`, {
      method: 'POST', redirect: 'manual', headers, body: new URLSearchParams({ action: 'retry', runId }),
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin');

    const deadline = Date.now() + 5_000;
    while (!receivedJob && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(receivedJob?.submissionId, submissionId);
    assert.equal(receivedJob?.runId, runId);

    const [run] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, runId));
    assert.equal(run.status, 'queued');
    queueJobId = run.queueJobId;
    const [submission] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    assert.equal(submission.status, 'queued');

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.targetId, runId));
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].actorId, adminUserId);
    assert.equal(auditRows[0].action, 'grading_run.retry');
    assert.equal(auditRows[0].targetType, 'grading_run');
  } finally {
    if (queueJobId) await boss.cancel(queueJobId);
    await db.delete(auditLog).where(eq(auditLog.targetId, runId));
    await db.delete(gradingRuns).where(eq(gradingRuns.id, runId));
    await db.delete(submissions).where(eq(submissions.id, submissionId));
  }
});

test('POST /admin cancel stops a running run, cancels its queue job, and records one audit row naming the admin', async () => {
  const headers = { Cookie: `${SESSION_COOKIE}=${adminSessionId}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  const submissionId = randomUUID();
  const runId = randomUUID();
  let queueJobId: string | null = null;
  try {
    await db.insert(submissions).values({ id: submissionId, enrollmentId, commitSha: randomUUID(), status: 'running' });
    queueJobId = await boss.send(GRADING_TOPIC, { runId, submissionId }, { retryLimit: 3 });
    assert.ok(queueJobId);
    await db.insert(gradingRuns).values({ id: runId, submissionId, status: 'running', currentStage: 'build', queueJobId });

    const response = await fetch(`http://127.0.0.1:${port}/admin`, {
      method: 'POST', redirect: 'manual', headers, body: new URLSearchParams({ action: 'cancel', runId }),
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin');

    const [run] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, runId));
    assert.equal(run.status, 'cancelled');
    const [submission] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    assert.equal(submission.status, 'cancelled');

    const cancelledJob = await boss.getJobById(queueJobId);
    assert.equal(cancelledJob?.state, 'cancelled');

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.targetId, runId));
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].actorId, adminUserId);
    assert.equal(auditRows[0].action, 'grading_run.cancel');
    assert.equal(auditRows[0].targetType, 'grading_run');
  } finally {
    if (queueJobId) await boss.cancel(queueJobId);
    await db.delete(auditLog).where(eq(auditLog.targetId, runId));
    await db.delete(gradingRuns).where(eq(gradingRuns.id, runId));
    await db.delete(submissions).where(eq(submissions.id, submissionId));
  }
});
