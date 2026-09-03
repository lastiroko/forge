import { cookies } from 'next/headers';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';

const { users, sessions, enrollments, challengeVersions, challenges, stacks, submissions, gradingRuns } = schema;

export type User = typeof users.$inferSelect;

export type Session = typeof sessions.$inferSelect;

export type Role = 'member' | 'author' | 'admin';

export const SESSION_COOKIE = 'forge_session';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface SessionCookieReader {
  get(name: string): { value: string } | undefined;
}

export interface GitHubIdentity {
  githubId: number;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  email: string;
}

export async function upsertGithubUser(
  identity: GitHubIdentity,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<User> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [user] = await db
      .insert(users)
      .values({ ...identity, role: 'member' })
      .onConflictDoUpdate({
        target: users.githubId,
        set: {
          handle: identity.handle,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          email: identity.email,
        },
      })
      .returning();
    return user;
  } finally {
    await pool.end();
  }
}

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
        isNotNull(gradingRuns.score),
      ))
      .orderBy(asc(enrollments.createdAt), asc(enrollments.id));

    const bestByEnrollment = new Map<string, CompletedChallenge>();
    for (const row of rows) {
      // The query excludes null scores; retain the check so TypeScript and future
      // query changes preserve the successful-run invariant at this boundary.
      if (row.score === null) continue;
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

export async function createSession(
  userId: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Session> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [session] = await db
      .insert(sessions)
      .values({ userId, expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) })
      .returning();
    return session;
  } finally {
    await pool.end();
  }
}

export async function getCurrentUser(
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<User | undefined> {
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return undefined;

  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db
      .select({ user: users, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, sessionId));
    if (!row || row.expiresAt.getTime() <= Date.now()) return undefined;
    return row.user;
  } finally {
    await pool.end();
  }
}

export async function deleteSession(
  sessionId: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<void> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  } finally {
    await pool.end();
  }
}

export async function requireRole(role: Role): Promise<User> {
  throw new Error('identity.requireRole is not implemented yet');
}
