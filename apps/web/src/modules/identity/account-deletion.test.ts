import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import {
  AuthorizationError,
  createSession,
  deleteCurrentUserAccount,
  SESSION_COOKIE,
  type SessionCookieReader,
} from './index.js';

const { users, sessions, pointsLedger, auditLog, pointsTotalsCache, leaderboardSnapshots } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

function cookieStoreFor(sessionId: string | undefined): SessionCookieReader {
  return {
    get: (name: string) => (sessionId !== undefined && name === SESSION_COOKIE ? { value: sessionId } : undefined),
  };
}

let githubIdCounter = 0;

async function insertUser(db: ReturnType<typeof createDbClient>['db'], displayName: string) {
  githubIdCounter += 1;
  const [user] = await db
    .insert(users)
    .values({
      githubId: Date.now() * 1000 + githubIdCounter,
      handle: `account-deletion-${randomUUID()}`,
      displayName,
      avatarUrl: 'https://example.com/avatar.png',
      email: `account-deletion-${randomUUID()}@example.com`,
      role: 'member',
      bio: 'Some bio text.',
      links: ['https://example.com'],
    })
    .returning();
  return user;
}

test('deleteCurrentUserAccount requires an authenticated session', async () => {
  await assert.rejects(
    () => deleteCurrentUserAccount(cookieStoreFor(undefined), databaseUrl),
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationError);
      assert.equal(error.status, 403);
      return true;
    },
  );
});

test('deleteCurrentUserAccount anonymises only the deleted member, preserving the other member and every ledger and audit row', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  const ledgerIds: string[] = [];
  const auditIds: string[] = [];

  try {
    const deletedMember = await insertUser(db, 'Deletion Target');
    const otherMember = await insertUser(db, 'Untouched Member');
    userIds.push(deletedMember.id, otherMember.id);

    const deletedSessionOne = await createSession(deletedMember.id, databaseUrl);
    const deletedSessionTwo = await createSession(deletedMember.id, databaseUrl);
    const otherSession = await createSession(otherMember.id, databaseUrl);
    sessionIds.push(deletedSessionOne.id, deletedSessionTwo.id, otherSession.id);

    const [ledgerFirst] = await db.insert(pointsLedger)
      .values({ userId: deletedMember.id, delta: 10, reason: 'challenge_passed' })
      .returning();
    const [ledgerSecond] = await db.insert(pointsLedger)
      .values({ userId: deletedMember.id, delta: -3, reason: 'admin_correction' })
      .returning();
    const [otherLedger] = await db.insert(pointsLedger)
      .values({ userId: otherMember.id, delta: 5, reason: 'challenge_passed' })
      .returning();
    ledgerIds.push(ledgerFirst.id, ledgerSecond.id, otherLedger.id);

    const [auditRow] = await db.insert(auditLog)
      .values({
        actorId: deletedMember.id,
        action: 'solution.publish',
        targetType: 'solution',
        targetId: randomUUID(),
        reason: 'Approved for publication',
      })
      .returning();
    auditIds.push(auditRow.id);

    await db.insert(pointsTotalsCache).values([
      { userId: deletedMember.id, totalPoints: 7 },
      { userId: otherMember.id, totalPoints: 5 },
    ]);

    const [, otherSnapshot] = await db.insert(leaderboardSnapshots).values([
      { scope: 'global', userId: deletedMember.id, totalPoints: 7, rank: 2 },
      { scope: 'global', userId: otherMember.id, totalPoints: 5, rank: 1 },
    ]).returning();

    const anonymised = await deleteCurrentUserAccount(cookieStoreFor(deletedSessionOne.id), databaseUrl);

    assert.equal(anonymised.id, deletedMember.id);
    assert.equal(anonymised.githubId, null);
    assert.equal(anonymised.handle, `deleted-${deletedMember.id}`);
    assert.equal(anonymised.displayName, 'Deleted member');
    assert.equal(anonymised.email, `deleted-${deletedMember.id}@invalid`);
    assert.equal(anonymised.avatarUrl, null);
    assert.equal(anonymised.bio, null);
    assert.deepEqual(anonymised.links, []);
    assert.equal(anonymised.role, 'member');
    assert.ok(anonymised.deletedAt instanceof Date);

    const [persistedDeleted] = await db.select().from(users).where(eq(users.id, deletedMember.id));
    assert.deepEqual(persistedDeleted, anonymised);

    const remainingDeletedSessions = await db
      .select()
      .from(sessions)
      .where(inArray(sessions.id, [deletedSessionOne.id, deletedSessionTwo.id]));
    assert.equal(remainingDeletedSessions.length, 0);

    const [persistedOther] = await db.select().from(users).where(eq(users.id, otherMember.id));
    assert.deepEqual(persistedOther, otherMember);

    const remainingOtherSessions = await db.select().from(sessions).where(eq(sessions.id, otherSession.id));
    assert.equal(remainingOtherSessions.length, 1);

    const deletedMemberLedgerRows = await db
      .select()
      .from(pointsLedger)
      .where(inArray(pointsLedger.id, [ledgerFirst.id, ledgerSecond.id]));
    assert.equal(deletedMemberLedgerRows.length, 2);
    assert.equal(deletedMemberLedgerRows.reduce((sum, row) => sum + row.delta, 0), 7);
    for (const row of deletedMemberLedgerRows) {
      assert.equal(row.userId, deletedMember.id);
    }

    const [persistedAudit] = await db.select().from(auditLog).where(eq(auditLog.id, auditRow.id));
    assert.equal(persistedAudit.actorId, deletedMember.id);
    assert.equal(persistedAudit.action, 'solution.publish');

    const [persistedOtherSnapshot] = await db
      .select()
      .from(leaderboardSnapshots)
      .where(eq(leaderboardSnapshots.id, otherSnapshot.id));
    assert.deepEqual(persistedOtherSnapshot, otherSnapshot);
  } finally {
    if (ledgerIds.length > 0) await db.delete(pointsLedger).where(inArray(pointsLedger.id, ledgerIds));
    if (auditIds.length > 0) await db.delete(auditLog).where(inArray(auditLog.id, auditIds));
    if (userIds.length > 0) {
      await db.delete(leaderboardSnapshots).where(inArray(leaderboardSnapshots.userId, userIds));
      await db.delete(pointsTotalsCache).where(inArray(pointsTotalsCache.userId, userIds));
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await pool.end();
  }
});
