import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import {
  createSession,
  SESSION_COOKIE,
  type SessionCookieReader,
  type User,
} from '../modules/identity/index.js';
import { GRADING_FINISHED_EVENT, listForUser, notify } from '../modules/notifications/index.js';
import { markNotificationsRead } from './mark-notifications-read.js';

const { users, sessions, notifications } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

function cookieStoreFor(sessionId: string | undefined): SessionCookieReader {
  return {
    get: (name: string) => (sessionId !== undefined && name === SESSION_COOKIE ? { value: sessionId } : undefined),
  };
}

test('marks only the acting member notification and rejects an unauthenticated caller without changing rows', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  const notificationIds: string[] = [];

  async function createUser(label: string): Promise<{ user: User; cookies: SessionCookieReader }> {
    const unique = randomUUID();
    const [user] = await db.insert(users).values({
      githubId: Math.floor(Math.random() * 1_000_000_000),
      handle: `actions-${label}-${unique}`,
      displayName: `Actions ${label}`,
      email: `actions-${label}-${unique}@example.com`,
      role: 'member',
    }).returning();
    userIds.push(user.id);
    const session = await createSession(user.id, databaseUrl);
    sessionIds.push(session.id);
    return { user, cookies: cookieStoreFor(session.id) };
  }

  try {
    const first = await createUser('first');
    const second = await createUser('second');

    const firstNotification = await notify(
      first.user,
      { type: GRADING_FINISHED_EVENT, runId: randomUUID(), submissionId: randomUUID(), score: 80 },
      databaseUrl,
    );
    const secondNotification = await notify(
      second.user,
      { type: GRADING_FINISHED_EVENT, runId: randomUUID(), submissionId: randomUUID(), score: 80 },
      databaseUrl,
    );
    notificationIds.push(firstNotification.id, secondNotification.id);

    await markNotificationsRead([firstNotification.id, secondNotification.id], first.cookies);

    const firstRows = await listForUser(first.user, databaseUrl);
    const secondRows = await listForUser(second.user, databaseUrl);
    assert.notEqual(firstRows.find((row) => row.id === firstNotification.id)?.readAt, null);
    assert.equal(secondRows.find((row) => row.id === secondNotification.id)?.readAt, null);

    await assert.rejects(() => markNotificationsRead([secondNotification.id], cookieStoreFor(undefined)));

    const secondRowsAfter = await listForUser(second.user, databaseUrl);
    assert.equal(secondRowsAfter.find((row) => row.id === secondNotification.id)?.readAt, null);
  } finally {
    if (notificationIds.length > 0) await db.delete(notifications).where(inArray(notifications.id, notificationIds));
    if (sessionIds.length > 0) await db.delete(sessions).where(inArray(sessions.id, sessionIds));
    if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  }
});
