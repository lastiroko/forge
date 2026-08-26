import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';

const { challenges, challengeVersions } = schema;

export type Challenge = typeof challenges.$inferSelect;
export type ChallengeVersion = typeof challengeVersions.$inferSelect;

export interface ListChallengesFilters {
  level?: string;
}

export async function listChallenges(
  filters: ListChallengesFilters = {},
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Challenge[]> {
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

    return await db
      .select()
      .from(challenges)
      .where(and(...conditions));
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

export async function getLatestPublishedVersion(
  challengeId: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<ChallengeVersion | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db
      .select()
      .from(challengeVersions)
      .where(and(eq(challengeVersions.challengeId, challengeId), isNotNull(challengeVersions.publishedAt)))
      .orderBy(desc(challengeVersions.version))
      .limit(1);
    return row;
  } finally {
    await pool.end();
  }
}
