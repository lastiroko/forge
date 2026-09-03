import { and, desc, eq, sql } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';

const { leaderboardSnapshots, users, pointsLedger, pointsTotalsCache } = schema;

export const GLOBAL_SCOPE = 'global';

export interface LeaderboardEntry {
  userId: string;
  handle: string;
  totalPoints: number;
  rank: number;
}

export async function getLeaderboard(
  scope: string = GLOBAL_SCOPE,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<LeaderboardEntry[]> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const condition =
      scope === GLOBAL_SCOPE
        ? eq(leaderboardSnapshots.scope, 'global')
        : and(eq(leaderboardSnapshots.scope, 'stack'), eq(leaderboardSnapshots.stackId, scope));

    const rows = await db
      .select({
        userId: leaderboardSnapshots.userId,
        handle: users.handle,
        totalPoints: leaderboardSnapshots.totalPoints,
        rank: leaderboardSnapshots.rank,
      })
      .from(leaderboardSnapshots)
      .innerJoin(users, eq(leaderboardSnapshots.userId, users.id))
      .where(condition)
      .orderBy(desc(leaderboardSnapshots.totalPoints));

    return rows;
  } finally {
    await pool.end();
  }
}

export async function getTotals(userId: string, databaseUrl: string = loadEnv().DATABASE_URL): Promise<number> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [cached] = await db.select().from(pointsTotalsCache).where(eq(pointsTotalsCache.userId, userId));
    if (cached) {
      return cached.totalPoints;
    }

    const [{ total }] = await db
      .select({ total: sql<number>`coalesce(sum(${pointsLedger.delta}), 0)::int` })
      .from(pointsLedger)
      .where(eq(pointsLedger.userId, userId));

    await db
      .insert(pointsTotalsCache)
      .values({ userId, totalPoints: total })
      .onConflictDoUpdate({ target: pointsTotalsCache.userId, set: { totalPoints: total } });

    return total;
  } finally {
    await pool.end();
  }
}
