import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { pointsLedger } from './schema.js';

test('inserts two points_ledger rows for a user and sums delta to the expected total', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  let insertedFirstId;
  let insertedSecondId;
  try {
    const [insertedFirst] = await db
      .insert(pointsLedger)
      .values({ userId, delta: 10, reason: 'challenge_passed' })
      .returning();
    insertedFirstId = insertedFirst.id;

    const [insertedSecond] = await db
      .insert(pointsLedger)
      .values({ userId, delta: -3, reason: 'admin_correction' })
      .returning();
    insertedSecondId = insertedSecond.id;

    const rows = await db.select().from(pointsLedger).where(eq(pointsLedger.userId, userId));

    assert.equal(rows.length, 2);
    assert.equal(rows.reduce((sum, r) => sum + r.delta, 0), 7);
  } finally {
    if (insertedFirstId) {
      await db.delete(pointsLedger).where(eq(pointsLedger.id, insertedFirstId));
    }
    if (insertedSecondId) {
      await db.delete(pointsLedger).where(eq(pointsLedger.id, insertedSecondId));
    }
    await pool.end();
  }
});
