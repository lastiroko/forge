import { and, desc, eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';

const { leaderboardSnapshots, users } = schema;

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
