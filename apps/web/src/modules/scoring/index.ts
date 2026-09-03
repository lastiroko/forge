import { and, desc, eq, sql } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';

const {
  challengeVersions, enrollments, gradingRuns, leaderboardSnapshots, submissions, users, pointsLedger, pointsTotalsCache,
} = schema;

export const GLOBAL_SCOPE = 'global';

export interface LeaderboardEntry {
  userId: string;
  handle: string;
  totalPoints: number;
  rank: number;
}

export interface CompletedRun {
  id: string;
  score: number;
}

const BASE_POINTS: Record<string, number> = {
  junior: 100,
  mid: 300,
  senior: 700,
};

export async function award(
  run: CompletedRun,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<void> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [fixture] = await db
      .select({
        userId: enrollments.userId,
        stackId: enrollments.stackId,
        level: challengeVersions.level,
      })
      .from(gradingRuns)
      .innerJoin(submissions, eq(gradingRuns.submissionId, submissions.id))
      .innerJoin(enrollments, eq(submissions.enrollmentId, enrollments.id))
      .innerJoin(challengeVersions, eq(enrollments.challengeVersionId, challengeVersions.id))
      .where(eq(gradingRuns.id, run.id));

    if (!fixture) throw new Error(`Scoring module: incomplete fixture for grading run ${run.id}`);
    const basePoints = BASE_POINTS[fixture.level];
    if (!basePoints) throw new Error(`Scoring module: unsupported challenge level ${fixture.level}`);
    if (run.score < 70) return;

    await db.insert(pointsLedger).values({
      userId: fixture.userId,
      stackId: fixture.stackId,
      delta: Math.round(basePoints * run.score / 100),
      reason: 'challenge_completed',
      gradingRunId: run.id,
    }).onConflictDoNothing();
  } finally {
    await pool.end();
  }
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
