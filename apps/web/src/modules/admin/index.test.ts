import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { AuthorizationError, SESSION_COOKIE, type SessionCookieReader } from '../identity/index.js';
import { hideContent, suspendMember, warnMember } from './index.js';

const { users, sessions, enrollments, submissions, solutions, comments, auditLog } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const store = (id?: string): SessionCookieReader => ({ get: (name) => name === SESSION_COOKIE && id ? { value: id } : undefined });

test('admin moderation validates, mutates targets, and writes exactly one trimmed audit row per action', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  let enrollmentId: string | undefined;
  let submissionId: string | undefined;
  let solutionId: string | undefined;
  let commentId: string | undefined;
  try {
    for (const role of ['admin', 'member'] as const) {
      const [user] = await db.insert(users).values({ githubId: Date.now() + userIds.length, handle: `admin-module-${randomUUID()}`, displayName: role, email: `${randomUUID()}@example.com`, role }).returning();
      userIds.push(user.id);
      const [session] = await db.insert(sessions).values({ userId: user.id, expiresAt: new Date(Date.now() + 60_000) }).returning();
      sessionIds.push(session.id);
    }
    const [adminId, memberId] = userIds;
    const [adminSession, memberSession] = sessionIds;
    const missingId = randomUUID();
    const [enrollment] = await db.insert(enrollments).values({ userId: memberId, challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active' }).returning();
    enrollmentId = enrollment.id;
    const [submission] = await db.insert(submissions).values({ enrollmentId, commitSha: randomUUID(), status: 'graded' }).returning();
    submissionId = submission.id;
    const [solution] = await db.insert(solutions).values({ submissionId, title: 'Target', writeup: 'Body', publishedAt: new Date() }).returning();
    solutionId = solution.id;
    const [comment] = await db.insert(comments).values({ targetType: 'solution', targetId: solutionId, authorId: memberId, body: 'Target' }).returning();
    commentId = comment.id;

    await assert.rejects(() => hideContent({ type: 'solution', id: solutionId! }, 'reason', store(memberSession), databaseUrl), AuthorizationError);
    await assert.rejects(() => warnMember(memberId, '   ', store(adminSession), databaseUrl), /reason is required/);
    await assert.rejects(() => hideContent({ type: 'comment', id: commentId! }, '   ', store(adminSession), databaseUrl), /reason is required/);
    await assert.rejects(() => suspendMember(memberId, '   ', store(adminSession), databaseUrl), /reason is required/);
    await assert.rejects(() => suspendMember(adminId, 'reason', store(adminSession), databaseUrl), AuthorizationError);
    await assert.rejects(() => hideContent({ type: 'solution', id: missingId }, 'missing', store(adminSession), databaseUrl), /no solution found/);
    await assert.rejects(() => warnMember(missingId, 'missing', store(adminSession), databaseUrl), /no user found/);
    await assert.rejects(() => suspendMember(missingId, 'missing', store(adminSession), databaseUrl), /no user found/);
    assert.equal((await db.select().from(auditLog).where(eq(auditLog.targetId, missingId))).length, 0);

    await hideContent({ type: 'solution', id: solutionId }, '  solution reason  ', store(adminSession), databaseUrl);
    await hideContent({ type: 'comment', id: commentId }, 'comment reason', store(adminSession), databaseUrl);
    await warnMember(memberId, 'warning reason', store(adminSession), databaseUrl);
    await suspendMember(memberId, 'suspension reason', store(adminSession), databaseUrl);

    assert.ok((await db.select().from(solutions).where(eq(solutions.id, solutionId)))[0].hiddenAt);
    assert.ok((await db.select().from(comments).where(eq(comments.id, commentId)))[0].hiddenAt);
    assert.ok((await db.select().from(users).where(eq(users.id, memberId)))[0].suspendedAt);
    const rows = await db.select().from(auditLog).where(inArray(auditLog.targetId, [solutionId, commentId, memberId]));
    assert.equal(rows.length, 4);
    for (const expected of [
      { action: 'content.hide', targetType: 'solution', targetId: solutionId, reason: 'solution reason' },
      { action: 'content.hide', targetType: 'comment', targetId: commentId, reason: 'comment reason' },
      { action: 'member.warn', targetType: 'user', targetId: memberId, reason: 'warning reason' },
      { action: 'member.suspend', targetType: 'user', targetId: memberId, reason: 'suspension reason' },
    ]) {
      const matching = rows.filter((row) => row.action === expected.action && row.targetType === expected.targetType && row.targetId === expected.targetId);
      assert.equal(matching.length, 1);
      assert.equal(matching[0].actorId, adminId);
      assert.equal(matching[0].reason, expected.reason);
    }
  } finally {
    if (userIds.length || solutionId || commentId) await db.delete(auditLog).where(inArray(auditLog.targetId, [...userIds, ...(solutionId ? [solutionId] : []), ...(commentId ? [commentId] : [])]));
    if (commentId) await db.delete(comments).where(eq(comments.id, commentId));
    if (solutionId) await db.delete(solutions).where(eq(solutions.id, solutionId));
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (sessionIds.length) await db.delete(sessions).where(inArray(sessions.id, sessionIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  }
});
