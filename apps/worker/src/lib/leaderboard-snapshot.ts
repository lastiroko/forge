import type PgBoss from 'pg-boss';
import { createDbClient, leaderboardSnapshots, pointsEntries } from '@forge/db';
import { loadEnv } from '@forge/shared';

export const LEADERBOARD_SNAPSHOT_QUEUE = 'leaderboard-snapshot';
export const LEADERBOARD_SNAPSHOT_CRON = '*/5 * * * *';

type Ranking = {
  userId: string;
  totalPoints: number;
};

function rankTotals(totals: Map<string, number>): Ranking[] {
  return [...totals]
    .map(([userId, totalPoints]) => ({ userId, totalPoints }))
    .sort((left, right) => right.totalPoints - left.totalPoints);
}

export async function recomputeLeaderboardSnapshots(databaseUrl?: string): Promise<void> {
  const { db, pool } = createDbClient(databaseUrl);

  try {
    const entries = await db.select().from(pointsEntries);
    const globalTotals = new Map<string, number>();
    const stackTotals = new Map<string, Map<string, number>>();

    for (const entry of entries) {
      globalTotals.set(entry.userId, (globalTotals.get(entry.userId) ?? 0) + entry.delta);
      const totals = stackTotals.get(entry.stackId) ?? new Map<string, number>();
      totals.set(entry.userId, (totals.get(entry.userId) ?? 0) + entry.delta);
      stackTotals.set(entry.stackId, totals);
    }

    const computedAt = new Date();
    const snapshots = rankTotals(globalTotals).map((ranking, index) => ({
      scope: 'global',
      stackId: null,
      ...ranking,
      rank: index + 1,
      computedAt,
    }));

    for (const [stackId, totals] of stackTotals) {
      snapshots.push(...rankTotals(totals).map((ranking, index) => ({
        scope: 'stack',
        stackId,
        ...ranking,
        rank: index + 1,
        computedAt,
      })));
    }

    await db.transaction(async (transaction) => {
      await transaction.delete(leaderboardSnapshots);
      if (snapshots.length > 0) {
        await transaction.insert(leaderboardSnapshots).values(snapshots);
      }
    });
  } finally {
    await pool.end();
  }
}

type RegisterLeaderboardSnapshotJobOptions = {
  queueName?: string;
  cron?: string;
  databaseUrl?: string;
};

export async function registerLeaderboardSnapshotJob(
  boss: PgBoss,
  options: RegisterLeaderboardSnapshotJobOptions = {},
): Promise<void> {
  const queueName = options.queueName ?? LEADERBOARD_SNAPSHOT_QUEUE;
  const cron = options.cron ?? LEADERBOARD_SNAPSHOT_CRON;
  const databaseUrl = options.databaseUrl ?? loadEnv().DATABASE_URL;

  await boss.work(queueName, () => recomputeLeaderboardSnapshots(databaseUrl));
  await boss.schedule(queueName, cron);
}
