import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { SESSION_COOKIE } from '../../../modules/identity/index.js';

const { users, sessions, enrollments, submissions, gradingRuns } = schema;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3422;
const { db, pool } = createDbClient(databaseUrl);
const ids: Record<string, string[]> = { users: [], sessions: [], enrollments: [], submissions: [], runs: [] };
let enrollmentId: string;
let ownerSessionId: string;
let adminSessionId: string;
let outsiderSessionId: string;
let server: ChildProcess | undefined;

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await fetch(url); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`server at ${url} did not become ready`);
}

function sessionHeaders(sessionId: string): { cookie: string } {
  return { cookie: `${SESSION_COOKIE}=${sessionId}` };
}

before(async () => {
  const createdUsers = await db.insert(users).values([
    { githubId: 56360, handle: 'history-owner', displayName: 'History Owner', email: 'history-owner@example.com', role: 'member' },
    { githubId: 56361, handle: 'history-admin', displayName: 'History Admin', email: 'history-admin@example.com', role: 'admin' },
    { githubId: 56362, handle: 'history-outsider', displayName: 'History Outsider', email: 'history-outsider@example.com', role: 'member' },
  ]).returning();
  ids.users.push(...createdUsers.map(({ id }) => id));
  const createdSessions = await db.insert(sessions).values(createdUsers.map(({ id }) => ({ userId: id, expiresAt: new Date(Date.now() + 60_000) }))).returning();
  ids.sessions.push(...createdSessions.map(({ id }) => id));
  [ownerSessionId, adminSessionId, outsiderSessionId] = createdSessions.map(({ id }) => id);

  const [enrollment] = await db.insert(enrollments).values({
    userId: createdUsers[0].id, challengeVersionId: createdUsers[0].id, mode: 'backend', stackId: createdUsers[0].id, status: 'active',
  }).returning();
  enrollmentId = enrollment.id;
  ids.enrollments.push(enrollment.id);
  const seededSubmissions = await db.insert(submissions).values([
    { enrollmentId, commitSha: 'commit-forty', status: 'successful' },
    { enrollmentId, commitSha: 'commit-ninety', status: 'successful' },
  ]).returning();
  ids.submissions.push(...seededSubmissions.map(({ id }) => id));
  const seededRuns = await db.insert(gradingRuns).values(seededSubmissions.map((submission, index) => ({
    submissionId: submission.id, status: 'successful', score: index ? 90 : 40,
    reportUrl: `https://report.example/${index}`, buildLogUrl: `https://build.example/${index}`, appLogUrl: `https://app.example/${index}`,
  }))).returning();
  ids.runs.push(...seededRuns.map(({ id }) => id));

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });
  server = spawn('node', ['.next/standalone/apps/web/server.js'], {
    cwd: webRoot, env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' },
  });
  await waitForServer(`http://127.0.0.1:${port}/enrollments/${enrollmentId}`);
});

after(async () => {
  if (server) server.kill();
  if (ids.runs.length) await db.delete(gradingRuns).where(inArray(gradingRuns.id, ids.runs));
  if (ids.submissions.length) await db.delete(submissions).where(inArray(submissions.id, ids.submissions));
  if (ids.enrollments.length) await db.delete(enrollments).where(inArray(enrollments.id, ids.enrollments));
  if (ids.sessions.length) await db.delete(sessions).where(inArray(sessions.id, ids.sessions));
  if (ids.users.length) await db.delete(users).where(inArray(users.id, ids.users));
  await pool.end();
});

test('GET /enrollments/:id renders every run and artifact for owner and admin', async () => {
  for (const sessionId of [ownerSessionId, adminSessionId]) {
    const response = await fetch(`http://127.0.0.1:${port}/enrollments/${enrollmentId}`, { headers: sessionHeaders(sessionId) });
    const body = await response.text();
    assert.equal(response.status, 200);
    for (const content of ['Run history', 'commit-forty', 'commit-ninety']) assert.ok(body.includes(content));
    assert.match(body, /Score:.*40/);
    assert.match(body, /Score:.*90/);
    assert.equal(body.match(/Submission status: (?:<!-- -->)?successful/g)?.length, 2);
    assert.equal(body.match(/Run status: (?:<!-- -->)?successful/g)?.length, 2);
    for (const kind of ['report', 'build', 'app']) {
      for (const index of [0, 1]) assert.ok(body.includes(`href="https://${kind}.example/${index}"`));
    }
  }
});

test('GET /enrollments/:id returns 404 for missing or unauthorized enrollment history', async () => {
  const requests: Array<[string, { cookie: string } | undefined]> = [
    [`http://127.0.0.1:${port}/enrollments/${enrollmentId}`, undefined],
    [`http://127.0.0.1:${port}/enrollments/${enrollmentId}`, sessionHeaders(outsiderSessionId)],
    [`http://127.0.0.1:${port}/enrollments/00000000-0000-4000-8000-000000000000`, sessionHeaders(ownerSessionId)],
  ];
  for (const [url, headers] of requests) assert.equal((await fetch(url, { headers })).status, 404);
});
