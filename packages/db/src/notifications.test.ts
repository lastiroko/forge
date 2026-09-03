import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { notifications, notificationPreferences } from './schema.js';

test('inserts a notification and a notification preference and reads them back', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://forge:forge@postgres:5432/forge';
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const submissionId = randomUUID();
  let insertedNotification;
  let insertedPreference;

  try {
    [insertedNotification] = await db.insert(notifications).values({
      userId,
      eventType: 'grading_finished',
      payload: { submissionId },
    }).returning();

    [insertedPreference] = await db.insert(notificationPreferences).values({
      userId,
      eventType: 'grading_finished',
      emailEnabled: false,
    }).returning();

    const [notificationRow] = await db.select().from(notifications)
      .where(eq(notifications.id, insertedNotification.id));
    const [preferenceRow] = await db.select().from(notificationPreferences)
      .where(eq(notificationPreferences.id, insertedPreference.id));

    assert.equal(notificationRow.userId, userId);
    assert.equal(notificationRow.eventType, 'grading_finished');
    assert.equal((notificationRow.payload as { submissionId: string }).submissionId, submissionId);
    assert.equal(notificationRow.readAt, null);
    assert.equal(preferenceRow.userId, userId);
    assert.equal(preferenceRow.eventType, 'grading_finished');
    assert.equal(preferenceRow.emailEnabled, false);
  } finally {
    if (insertedNotification) {
      await db.delete(notifications).where(eq(notifications.id, insertedNotification.id));
    }
    if (insertedPreference) {
      await db.delete(notificationPreferences).where(eq(notificationPreferences.id, insertedPreference.id));
    }
    await pool.end();
  }
});
