import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { AuthorizationError, SESSION_COOKIE, type SessionCookieReader } from '../../../modules/identity/index.js';
import {
  COMMENT_RECEIVED_EVENT,
  GRADING_FINISHED_EVENT,
  preferences,
  setEmailPreference,
} from '../../../modules/notifications/index.js';
import { saveNotificationPreferences } from './actions.js';
import { AccountSettingsPage } from './page.js';

const { users, sessions, notificationPreferences } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

function cookieStore(sessionId?: string): SessionCookieReader {
  return { get: (name) => name === SESSION_COOKIE && sessionId ? { value: sessionId } : undefined };
}

test('account settings is authenticated, defaults missing preferences on, and saves only the current member values', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const createdUsers = await db.insert(users).values([
    { githubId: Date.now(), handle: `settings-owner-${randomUUID()}`, displayName: 'Owner', email: `owner-${randomUUID()}@example.com`, role: 'member' },
    { githubId: Date.now() + 1, handle: `settings-other-${randomUUID()}`, displayName: 'Other', email: `other-${randomUUID()}@example.com`, role: 'member' },
  ]).returning();
  const userIds = createdUsers.map((user) => user.id);
  const createdSessions = await db.insert(sessions).values(createdUsers.map((user) => ({
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  }))).returning();

  try {
    await setEmailPreference(createdUsers[0], GRADING_FINISHED_EVENT, false, databaseUrl);
    await setEmailPreference(createdUsers[1], COMMENT_RECEIVED_EVENT, false, databaseUrl);

    const html = renderToStaticMarkup(await AccountSettingsPage(cookieStore(createdSessions[0].id), databaseUrl));
    assert.match(html, /Email me when grading finishes/);
    assert.match(html, /Email me when someone comments on my solution/);
    assert.doesNotMatch(html, new RegExp(`name="${GRADING_FINISHED_EVENT}"[^>]*checked`));
    assert.match(html, new RegExp(`name="${COMMENT_RECEIVED_EVENT}"[^>]*checked`));

    await assert.rejects(
      () => AccountSettingsPage(cookieStore(), databaseUrl),
      (error: unknown) => error instanceof AuthorizationError,
    );

    const formData = new FormData();
    formData.set(GRADING_FINISHED_EVENT, 'on');
    await saveNotificationPreferences(formData, cookieStore(createdSessions[0].id), databaseUrl);

    const ownerPreferences = await preferences(createdUsers[0], databaseUrl);
    assert.equal(ownerPreferences.find((row) => row.eventType === GRADING_FINISHED_EVENT)?.emailEnabled, true);
    assert.equal(ownerPreferences.find((row) => row.eventType === COMMENT_RECEIVED_EVENT)?.emailEnabled, false);
    assert.equal((await preferences(createdUsers[1], databaseUrl))[0].emailEnabled, false);
  } finally {
    await db.delete(notificationPreferences).where(inArray(notificationPreferences.userId, userIds));
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  }
});

test('submitting settings without checkbox values persists both settings as disabled', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const [user] = await db.insert(users).values({
    githubId: Date.now(), handle: `settings-unchecked-${randomUUID()}`, displayName: 'Unchecked',
    email: `unchecked-${randomUUID()}@example.com`, role: 'member',
  }).returning();
  const [session] = await db.insert(sessions).values({ userId: user.id, expiresAt: new Date(Date.now() + 60_000) }).returning();

  try {
    await saveNotificationPreferences(new FormData(), cookieStore(session.id), databaseUrl);
    const rows = await preferences(user, databaseUrl);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.emailEnabled === false));
  } finally {
    await db.delete(notificationPreferences).where(eq(notificationPreferences.userId, user.id));
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
    await pool.end();
  }
});
