import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';

const { challenges, challengeVersions, challengeStacks, stacks } = schema;

export type Challenge = typeof challenges.$inferSelect;
export type ChallengeVersion = typeof challengeVersions.$inferSelect;
export type Stack = typeof stacks.$inferSelect;

export type ChallengeSummary = Challenge & {
  enabledStacks: Stack[];
  basePoints: number;
  completionCount: number;
};

const CHALLENGE_BASE_POINTS: Record<string, number> = {
  junior: 100,
  mid: 300,
  senior: 700,
};

export interface ListChallengesFilters {
  level?: string;
  mode?: 'backend' | 'fullstack';
  stackId?: string;
  sort?: 'newest' | 'most-completed' | 'points';
}

export async function listChallenges(
  filters: ListChallengesFilters = {},
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<ChallengeSummary[]> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const publishedChallengeIds = db
      .selectDistinct({ challengeId: challengeVersions.challengeId })
      .from(challengeVersions)
      .where(isNotNull(challengeVersions.publishedAt));

    const conditions = [inArray(challenges.id, publishedChallengeIds)];
    if (filters.level) {
      conditions.push(eq(challenges.level, filters.level));
    }
    if (filters.mode === 'backend') {
      conditions.push(eq(challenges.backendEnabled, true));
    } else if (filters.mode === 'fullstack') {
      conditions.push(eq(challenges.fullstackEnabled, true));
    }
    if (filters.stackId) {
      conditions.push(
        inArray(
          challenges.id,
          db
            .selectDistinct({ challengeId: challengeStacks.challengeId })
            .from(challengeStacks)
            .where(eq(challengeStacks.stackId, filters.stackId)),
        ),
      );
    }

    const challengeRows = await db
      .select()
      .from(challenges)
      .where(and(...conditions));

    const challengeIds = challengeRows.map((challenge) => challenge.id);
    const stackRows = challengeIds.length
      ? await db
          .select({ challengeId: challengeStacks.challengeId, stack: stacks })
          .from(challengeStacks)
          .innerJoin(stacks, eq(challengeStacks.stackId, stacks.id))
          .where(inArray(challengeStacks.challengeId, challengeIds))
      : [];

    const stacksByChallengeId = new Map<string, Stack[]>();
    for (const row of stackRows) {
      const existing = stacksByChallengeId.get(row.challengeId) ?? [];
      existing.push(row.stack);
      stacksByChallengeId.set(row.challengeId, existing);
    }

    const summaries: ChallengeSummary[] = challengeRows.map((challenge) => ({
      ...challenge,
      enabledStacks: stacksByChallengeId.get(challenge.id) ?? [],
      basePoints: CHALLENGE_BASE_POINTS[challenge.level] ?? 0,
      // completionCount is hardcoded to 0 because no submissions/points module (E7) exists yet.
      completionCount: 0,
    }));

    const sort = filters.sort ?? 'newest';
    if (sort === 'points') {
      summaries.sort((a, b) => b.basePoints - a.basePoints);
    } else if (sort === 'most-completed') {
      summaries.sort((a, b) => b.completionCount - a.completionCount);
    } else {
      summaries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    return summaries;
  } finally {
    await pool.end();
  }
}

export async function getChallenge(
  id: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Challenge | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db.select().from(challenges).where(eq(challenges.id, id));
    return row;
  } finally {
    await pool.end();
  }
}

export async function getVersion(
  id: string,
  version: number,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<ChallengeVersion | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db
      .select()
      .from(challengeVersions)
      .where(
        and(
          eq(challengeVersions.challengeId, id),
          eq(challengeVersions.version, version),
          isNotNull(challengeVersions.publishedAt),
        ),
      );
    return row;
  } finally {
    await pool.end();
  }
}
