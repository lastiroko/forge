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

const { users, sessions, enrollments, submissions, gradingRuns, workerHeartbeats } = schema;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3466;
const { db, pool } = createDbClient(databaseUrl);
const boss = await getQueue(databaseUrl);
const ids = { users: [] as string[], sessions: [] as string[], submissions: [] as string[], runs: [] as string[] };
const enrollmentId = randomUUID();
const workerId = randomUUID();
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
  if (jobId) await boss.deleteJob(GRADING_TOPIC, jobId);
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
  assert.doesNotMatch(html, /<form|<button|retry|cancel|secret|configuration/i);
});
