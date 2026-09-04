import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { SESSION_COOKIE } from '../../modules/identity/index.js';

const { users, sessions, enrollments, submissions, solutions, comments, auditLog } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const port = 3467;
const { db, pool } = createDbClient(databaseUrl);
const userIds: string[] = [];
const sessionIds: string[] = [];
let enrollmentId = '';
let submissionId = '';
let solutionId = '';
let commentId = '';
let adminId = '';
let memberId = '';
let adminSession = '';
let memberSession = '';
let viewerSession = '';
let server: ChildProcess | undefined;

const headersFor = (sessionId: string) => ({ Cookie: `${SESSION_COOKIE}=${sessionId}`, 'Content-Type': 'application/x-www-form-urlencoded' });

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await fetch(`http://127.0.0.1:${port}/`); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error('moderation route server did not become ready');
}

before(async () => {
  const seededUsers = await db.insert(users).values((['admin', 'member', 'member'] as const).map((role) => ({
    githubId: Math.floor(Math.random() * 1_000_000_000), handle: `moderation-route-${randomUUID()}`, displayName: role, email: `${randomUUID()}@example.com`, role,
  }))).returning();
  userIds.push(...seededUsers.map((user) => user.id));
  [adminId, memberId] = userIds;
  const seededSessions = await db.insert(sessions).values(seededUsers.map((user) => ({ userId: user.id, expiresAt: new Date(Date.now() + 60_000) }))).returning();
  sessionIds.push(...seededSessions.map((session) => session.id));
  [adminSession, memberSession, viewerSession] = sessionIds;
  const [enrollment] = await db.insert(enrollments).values({ userId: memberId, challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active' }).returning();
  enrollmentId = enrollment.id;
  const [submission] = await db.insert(submissions).values({ enrollmentId, commitSha: randomUUID(), status: 'graded' }).returning();
  submissionId = submission.id;
  const [solution] = await db.insert(solutions).values({ submissionId, title: `Moderation route ${randomUUID()}`, writeup: 'Body', publishedAt: new Date() }).returning();
  solutionId = solution.id;
  const [comment] = await db.insert(comments).values({ targetType: 'solution', targetId: solutionId, authorId: memberId, body: 'Moderate this comment' }).returning();
  commentId = comment.id;

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });
  server = spawn('node', ['.next/standalone/apps/web/server.js'], { cwd: webRoot, env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' } });
  await waitForServer();
});

after(async () => {
  if (server) server.kill();
  await db.delete(auditLog).where(inArray(auditLog.targetId, [solutionId, commentId, memberId]));
  await db.delete(comments).where(eq(comments.id, commentId));
  await db.delete(solutions).where(eq(solutions.id, solutionId));
  await db.delete(submissions).where(eq(submissions.id, submissionId));
  await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
  await db.delete(sessions).where(inArray(sessions.id, sessionIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

test('moderation forms are admin-only and malformed or unauthorized posts do not mutate or audit', async () => {
  const admin = await fetch(`http://127.0.0.1:${port}/admin`, { headers: headersFor(adminSession) });
  const html = await admin.text();
  assert.equal(admin.status, 200);
  for (const action of ['hide-solution', 'hide-comment', 'warn-member', 'suspend-member']) assert.match(html, new RegExp(`name="action" value="${action}"`));
  assert.match(html, /name="targetId" required/);
  assert.match(html, /name="reason" required/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/admin`, { headers: headersFor(memberSession) })).status, 403);

  for (const sessionId of ['', memberSession]) {
    const response = await fetch(`http://127.0.0.1:${port}/admin`, {
      method: 'POST', redirect: 'manual', headers: sessionId ? headersFor(sessionId) : { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'hide-solution', targetId: solutionId, reason: 'not allowed' }),
    });
    assert.equal(response.status, 403);
  }
  for (const body of [
    new URLSearchParams({ action: 'unknown', targetId: solutionId, reason: 'reason' }),
    new URLSearchParams({ action: 'hide-solution', reason: 'reason' }),
    new URLSearchParams({ action: 'hide-solution', targetId: '   ', reason: 'reason' }),
    new URLSearchParams({ action: 'hide-solution', targetId: solutionId, reason: '   ' }),
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}/admin`, { method: 'POST', redirect: 'manual', headers: headersFor(adminSession), body });
    assert.equal(response.status, 400);
  }
  assert.equal((await db.select().from(auditLog).where(inArray(auditLog.targetId, [solutionId, memberId]))).length, 0);
  assert.equal((await db.select().from(solutions).where(eq(solutions.id, solutionId)))[0].hiddenAt, null);
});

test('all moderation actions mutate expected state and write exactly one audit row with the submitted reason', async () => {
  const actions = [
    { action: 'hide-comment', targetId: commentId, reason: '  hide comment  ', auditAction: 'content.hide', targetType: 'comment' },
    { action: 'warn-member', targetId: memberId, reason: '  warn member  ', auditAction: 'member.warn', targetType: 'user' },
    { action: 'suspend-member', targetId: memberId, reason: '  suspend member  ', auditAction: 'member.suspend', targetType: 'user' },
    { action: 'hide-solution', targetId: solutionId, reason: '  hide solution  ', auditAction: 'content.hide', targetType: 'solution' },
  ];
  for (const expected of actions) {
    const response = await fetch(`http://127.0.0.1:${port}/admin`, { method: 'POST', redirect: 'manual', headers: headersFor(adminSession), body: new URLSearchParams(expected) });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin');
    const rows = (await db.select().from(auditLog).where(eq(auditLog.targetId, expected.targetId))).filter((row) => row.action === expected.auditAction && row.targetType === expected.targetType);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actorId, adminId);
    assert.equal(rows[0].reason, expected.reason.trim());
  }
  assert.ok((await db.select().from(comments).where(eq(comments.id, commentId)))[0].hiddenAt);
  assert.ok((await db.select().from(users).where(eq(users.id, memberId)))[0].suspendedAt);
  assert.ok((await db.select().from(solutions).where(eq(solutions.id, solutionId)))[0].hiddenAt);

  const gallery = await fetch(`http://127.0.0.1:${port}/solutions`, { headers: headersFor(viewerSession) });
  assert.doesNotMatch(await gallery.text(), new RegExp(solutionId));
  const detail = await fetch(`http://127.0.0.1:${port}/solutions/${solutionId}`, { headers: headersFor(viewerSession) });
  assert.equal(detail.status, 404);
});
