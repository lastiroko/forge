import { and, eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';
import {
  getChallenge,
  getEnabledStacks,
  getLatestPublishedVersion,
} from '../catalogue/index.js';

const { enrollments, challengeVersions } = schema;

export type Enrollment = typeof enrollments.$inferSelect;

export class InvalidCombinationError extends Error {
  constructor() {
    super('The selected mode and stack combination is not enabled for this challenge.');
    this.name = 'InvalidCombinationError';
  }
}

export async function startChallenge(
  userId: string,
  challengeId: string,
  mode: 'backend' | 'fullstack',
  stackId: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Enrollment> {
  const challenge = await getChallenge(challengeId, databaseUrl);
  const modeEnabled = mode === 'backend' ? challenge?.backendEnabled : challenge?.fullstackEnabled;
  const enabledStacks = challenge ? await getEnabledStacks(challengeId, databaseUrl) : [];
  if (!challenge || !modeEnabled || !enabledStacks.some((stack) => stack.id === stackId)) {
    throw new InvalidCombinationError();
  }

  const version = await getLatestPublishedVersion(challengeId, databaseUrl);
  if (!version) {
    throw new Error(`Enrollment module: no published version found for challenge ${challengeId}`);
  }

  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [existing] = await db
      .select({ enrollment: enrollments })
      .from(enrollments)
      .innerJoin(challengeVersions, eq(enrollments.challengeVersionId, challengeVersions.id))
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(challengeVersions.challengeId, challengeId),
          eq(enrollments.status, 'active'),
        ),
      )
      .limit(1);
    if (existing) return existing.enrollment;

    const [inserted] = await db.insert(enrollments).values({
      userId,
      challengeVersionId: version.id,
      mode,
      stackId,
      repoUrl: null,
      status: 'active',
    }).returning();
    return inserted;
  } finally {
    await pool.end();
  }
}

export async function getEnrollment(
  id: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Enrollment | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db.select().from(enrollments).where(eq(enrollments.id, id));
    return row;
  } finally {
    await pool.end();
  }
}

export async function abandon(
  id: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Enrollment | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db
      .update(enrollments)
      .set({ status: 'abandoned' })
      .where(and(eq(enrollments.id, id), eq(enrollments.status, 'active')))
      .returning();
    return row;
  } finally {
    await pool.end();
  }
}
