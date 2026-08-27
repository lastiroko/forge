import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { leaderboardSnapshots, pointsLedger } from './schema.js';

test('inserts ledger entries and leaderboard snapshots and reads them back', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const stackId = randomUUID();
  const pointEntryIds: string[] = [];
  const snapshotIds: string[] = [];

  try {
    const insertedEntries = await db.insert(pointsLedger).values([
      { userId, stackId, delta: 10, reason: 'challenge completed' },
      { userId, stackId, delta: 5, reason: 'bonus' },
    ]).returning();
    pointEntryIds.push(...insertedEntries.map((entry) => entry.id));

    const insertedSnapshots = await db.insert(leaderboardSnapshots).values([
      { scope: 'global', stackId: null, userId, totalPoints: 15, rank: 1 },
      { scope: 'stack', stackId, userId, totalPoints: 15, rank: 1 },
    ]).returning();
    snapshotIds.push(...insertedSnapshots.map((snapshot) => snapshot.id));

    const entryRows = await db.select().from(pointsLedger).where(eq(pointsLedger.userId, userId));
    const snapshotRows = await db.select().from(leaderboardSnapshots).where(eq(leaderboardSnapshots.userId, userId));

    assert.deepEqual(entryRows.map((entry) => entry.delta).sort((a, b) => a - b), [5, 10]);
    assert.ok(entryRows.every((entry) => entry.stackId === stackId));
    assert.deepEqual(entryRows.map((entry) => entry.reason).sort(), ['bonus', 'challenge completed']);
    assert.deepEqual(snapshotRows.map((snapshot) => snapshot.scope).sort(), ['global', 'stack']);
    assert.ok(snapshotRows.every((snapshot) => snapshot.totalPoints === 15 && snapshot.rank === 1));
  } finally {
    for (const id of snapshotIds) {
      await db.delete(leaderboardSnapshots).where(eq(leaderboardSnapshots.id, id));
    }
    for (const id of pointEntryIds) {
      await db.delete(pointsLedger).where(eq(pointsLedger.id, id));
    }
    await pool.end();
  }
});
