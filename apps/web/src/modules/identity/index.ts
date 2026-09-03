import { and, asc, eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';

const { users, enrollments, challengeVersions, challenges, stacks, submissions, gradingRuns } = schema;

export type User = typeof users.$inferSelect;

export type Role = 'member' | 'author' | 'admin';

export interface CompletedChallenge {
  title: string;
  language: string;
  framework: string;
  mode: string;
  score: number;
}

export interface PublicProfile {
  displayName: string;
  handle: string;
  completedChallenges: CompletedChallenge[];
}

export async function getPublicProfile(
  handle: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<PublicProfile | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [user] = await db
      .select({ id: users.id, displayName: users.displayName, handle: users.handle })
      .from(users)
      .where(eq(users.handle, handle))
      .limit(1);
    if (!user) return undefined;

    const rows = await db
      .select({
        enrollmentId: enrollments.id,
        title: challenges.title,
        language: stacks.language,
        framework: stacks.framework,
        mode: enrollments.mode,
        score: gradingRuns.score,
      })
      .from(enrollments)
      .innerJoin(challengeVersions, eq(enrollments.challengeVersionId, challengeVersions.id))
      .innerJoin(challenges, eq(challengeVersions.challengeId, challenges.id))
      .innerJoin(stacks, eq(enrollments.stackId, stacks.id))
      .innerJoin(submissions, eq(submissions.enrollmentId, enrollments.id))
      .innerJoin(gradingRuns, eq(gradingRuns.submissionId, submissions.id))
      .where(and(
        eq(enrollments.userId, user.id),
        eq(enrollments.status, 'completed'),
        eq(gradingRuns.status, 'successful'),
      ))
      .orderBy(asc(enrollments.createdAt), asc(enrollments.id));

    const bestByEnrollment = new Map<string, CompletedChallenge>();
    for (const row of rows) {
      const existing = bestByEnrollment.get(row.enrollmentId);
      if (!existing || row.score > existing.score) {
        bestByEnrollment.set(row.enrollmentId, {
          title: row.title,
          language: row.language,
          framework: row.framework,
          mode: row.mode,
          score: row.score,
        });
      }
    }

    return { displayName: user.displayName, handle: user.handle, completedChallenges: [...bestByEnrollment.values()] };
  } finally {
    await pool.end();
  }
}

export async function getCurrentUser(): Promise<User | undefined> {
  throw new Error('identity.getCurrentUser is not implemented yet');
}

export async function requireRole(role: Role): Promise<User> {
  throw new Error('identity.requireRole is not implemented yet');
}
