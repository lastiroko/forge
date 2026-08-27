import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { createDbClient, getQueue, leaderboardSnapshots, pointsEntries } from '@forge/db';
import { recomputeLeaderboardSnapshots, registerLeaderboardSnapshotJob } from './leaderboard-snapshot.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

async function seedRankings() {
  const { db, pool } = createDbClient(databaseUrl);
  const userIds = [randomUUID(), randomUUID(), randomUUID()];
  const stackIds = [randomUUID(), randomUUID()];
  await db.insert(pointsEntries).values([
    { userId: userIds[0], stackId: stackIds[0], delta: 30, reason: 'test' },
    { userId: userIds[0], stackId: stackIds[1], delta: 10, reason: 'test' },
    { userId: userIds[1], stackId: stackIds[0], delta: 25, reason: 'test' },
    { userId: userIds[2], stackId: stackIds[1], delta: 20, reason: 'test' },
  ]);
  return { db, pool, userIds, stackIds };
}

async function assertRankings(
  db: ReturnType<typeof createDbClient>['db'],
  userIds: string[],
  stackIds: string[],
) {
  const globalRows = await db.select().from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.scope, 'global')).orderBy(asc(leaderboardSnapshots.rank));
  const firstStackRows = await db.select().from(leaderboardSnapshots)
    .where(and(eq(leaderboardSnapshots.scope, 'stack'), eq(leaderboardSnapshots.stackId, stackIds[0])))
    .orderBy(asc(leaderboardSnapshots.rank));
  const secondStackRows = await db.select().from(leaderboardSnapshots)
    .where(and(eq(leaderboardSnapshots.scope, 'stack'), eq(leaderboardSnapshots.stackId, stackIds[1])))
    .orderBy(asc(leaderboardSnapshots.rank));

  assert.deepEqual(globalRows.map(({ userId, totalPoints }) => ({ userId, totalPoints })), [
    { userId: userIds[0], totalPoints: 40 },
    { userId: userIds[1], totalPoints: 25 },
    { userId: userIds[2], totalPoints: 20 },
  ]);
  assert.deepEqual(firstStackRows.map(({ userId, totalPoints }) => ({ userId, totalPoints })), [
    { userId: userIds[0], totalPoints: 30 },
    { userId: userIds[1], totalPoints: 25 },
  ]);
  assert.deepEqual(secondStackRows.map(({ userId, totalPoints }) => ({ userId, totalPoints })), [
    { userId: userIds[2], totalPoints: 20 },
    { userId: userIds[0], totalPoints: 10 },
  ]);
}

async function cleanUpRankings(
  db: ReturnType<typeof createDbClient>['db'],
  userIds: string[],
) {
  await db.delete(leaderboardSnapshots).where(inArray(leaderboardSnapshots.userId, userIds));
  await db.delete(pointsEntries).where(inArray(pointsEntries.userId, userIds));
}

test('recomputes global and per-stack leaderboard snapshots', async () => {
  const { db, pool, userIds, stackIds } = await seedRankings();
  try {
    await recomputeLeaderboardSnapshots(databaseUrl);
    await assertRankings(db, userIds, stackIds);
  } finally {
    await cleanUpRankings(db, userIds);
    await pool.end();
  }
});

test('recomputes leaderboard snapshots through pg-boss', async () => {
  const { db, pool, userIds, stackIds } = await seedRankings();
  const boss = await getQueue(databaseUrl);
  const queueName = `leaderboard-snapshot-test-${randomUUID()}`;
  try {
    await registerLeaderboardSnapshotJob(boss, { queueName, databaseUrl });
    await boss.send(queueName);

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const rows = await db.select().from(leaderboardSnapshots)
        .where(eq(leaderboardSnapshots.scope, 'global'));
      if (rows.length === 3) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await assertRankings(db, userIds, stackIds);
  } finally {
    await cleanUpRankings(db, userIds);
    await boss.stop();
    await pool.end();
  }
});
