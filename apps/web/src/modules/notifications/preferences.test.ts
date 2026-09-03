import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import {
  COMMENT_RECEIVED_EVENT,
  GRADING_FINISHED_EVENT,
  preferences,
  setEmailPreference,
} from './index.js';

const { users, notificationPreferences } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

test('preference updates upsert supported events without changing other users or events', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const created = await db.insert(users).values([
    { githubId: Date.now(), handle: `preference-owner-${randomUUID()}`, displayName: 'Owner', email: `owner-${randomUUID()}@example.com`, role: 'member' },
    { githubId: Date.now() + 1, handle: `preference-other-${randomUUID()}`, displayName: 'Other', email: `other-${randomUUID()}@example.com`, role: 'member' },
  ]).returning();
  const userIds = created.map((user) => user.id);

  try {
    await setEmailPreference(created[0], GRADING_FINISHED_EVENT, false, databaseUrl);
    await setEmailPreference(created[0], COMMENT_RECEIVED_EVENT, true, databaseUrl);
    await setEmailPreference(created[1], GRADING_FINISHED_EVENT, true, databaseUrl);
    await setEmailPreference(created[0], GRADING_FINISHED_EVENT, true, databaseUrl);

    const ownerRows = await preferences(created[0], databaseUrl);
    assert.equal(ownerRows.length, 2);
    assert.equal(ownerRows.find((row) => row.eventType === GRADING_FINISHED_EVENT)?.emailEnabled, true);
    assert.equal(ownerRows.find((row) => row.eventType === COMMENT_RECEIVED_EVENT)?.emailEnabled, true);
    assert.equal((await preferences(created[1], databaseUrl))[0].emailEnabled, true);

    await assert.rejects(
      () => setEmailPreference(created[0], 'review_received', false, databaseUrl),
      /Unsupported email preference event/,
    );
  } finally {
    await db.delete(notificationPreferences).where(inArray(notificationPreferences.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  }
});
