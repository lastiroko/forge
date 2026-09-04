import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { AuthorizationError, getCurrentUser, requireRole, SESSION_COOKIE, type SessionCookieReader } from './index.js';

const { users, sessions } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

test('suspended sessions resolve identity but cannot pass role authorization', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  const store = (id: string): SessionCookieReader => ({ get: (name) => name === SESSION_COOKIE ? { value: id } : undefined });
  try {
    for (const suspendedAt of [new Date(), null]) {
      const [user] = await db.insert(users).values({ githubId: Date.now() + userIds.length, handle: `suspension-${randomUUID()}`, displayName: 'Member', email: `${randomUUID()}@example.com`, role: 'member', suspendedAt }).returning();
      userIds.push(user.id);
      const [session] = await db.insert(sessions).values({ userId: user.id, expiresAt: new Date(Date.now() + 60_000) }).returning();
      sessionIds.push(session.id);
    }
    assert.equal((await getCurrentUser(store(sessionIds[0]), databaseUrl))?.id, userIds[0]);
    await assert.rejects(() => requireRole('member', store(sessionIds[0]), databaseUrl), AuthorizationError);
    assert.equal((await requireRole('member', store(sessionIds[1]), databaseUrl)).id, userIds[1]);
  } finally {
    await db.delete(sessions).where(inArray(sessions.id, sessionIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  }
});
