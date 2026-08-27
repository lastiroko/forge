import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { notificationPreferences, notifications } from './schema.js';

test('inserts a notification and preference and reads them back', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://forge:forge@postgres:5432/forge';
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const submissionId = randomUUID();
  const eventType = 'grading_finished';
  let notificationId: string | undefined;
  let preferenceInserted = false;

  try {
    const [insertedNotification] = await db.insert(notifications).values({
      userId,
      eventType,
      payload: { submissionId },
    }).returning();
    notificationId = insertedNotification.id;

    await db.insert(notificationPreferences).values({
      userId,
      eventType,
    }).returning();
    preferenceInserted = true;

    const [notificationRow] = await db.select().from(notifications)
      .where(eq(notifications.id, notificationId));
    const [preferenceRow] = await db.select().from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.eventType, eventType),
      ));

    assert.equal(notificationRow.userId, userId);
    assert.equal(notificationRow.eventType, eventType);
    assert.equal((notificationRow.payload as { submissionId: string }).submissionId, submissionId);
    assert.equal(notificationRow.readAt, null);
    assert.ok(notificationRow.createdAt instanceof Date);
    assert.equal(preferenceRow.userId, userId);
    assert.equal(preferenceRow.eventType, eventType);
    assert.equal(preferenceRow.emailEnabled, true);
  } finally {
    if (notificationId) {
      await db.delete(notifications).where(eq(notifications.id, notificationId));
    }
    if (preferenceInserted) {
      await db.delete(notificationPreferences).where(and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.eventType, eventType),
      ));
    }
    await pool.end();
  }
});
