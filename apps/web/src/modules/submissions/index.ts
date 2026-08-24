import { and, eq, gte } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';

const { enrollments, challengeVersions, submissions } = schema;

export const RATE_LIMIT_MAX_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// Submission statuses caused by the platform, not the member, and therefore excluded
// from the rate-limit count. Empty today; add a value here once a platform-failure
// status exists instead of touching the counting logic in submit() below.
const RATE_LIMIT_EXCLUDED_STATUSES: readonly string[] = [];

export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Rate limit exceeded: ${RATE_LIMIT_MAX_PER_HOUR} submissions per hour per challenge. Retry after ${retryAfterSeconds} seconds.`);
    this.name = 'RateLimitExceededError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type Submission = typeof submissions.$inferSelect;

export async function submit(
  enrollmentId: string,
  commitSha: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Submission> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [enrollment] = await db.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
    if (!enrollment) {
      throw new Error(`Submissions module: no enrollment found with id ${enrollmentId}`);
    }

    const [challengeVersion] = await db
      .select()
      .from(challengeVersions)
      .where(eq(challengeVersions.id, enrollment.challengeVersionId));
    if (!challengeVersion) {
      throw new Error(`Submissions module: no challenge version found with id ${enrollment.challengeVersionId}`);
    }

    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

    const recent = await db
      .select({ id: submissions.id, status: submissions.status, createdAt: submissions.createdAt })
      .from(submissions)
      .innerJoin(enrollments, eq(submissions.enrollmentId, enrollments.id))
      .innerJoin(challengeVersions, eq(enrollments.challengeVersionId, challengeVersions.id))
      .where(
        and(
          eq(enrollments.userId, enrollment.userId),
          eq(challengeVersions.challengeId, challengeVersion.challengeId),
          gte(submissions.createdAt, windowStart),
        ),
      );

    const counted = recent.filter((row) => !RATE_LIMIT_EXCLUDED_STATUSES.includes(row.status));

    if (counted.length >= RATE_LIMIT_MAX_PER_HOUR) {
      const oldest = counted.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest.createdAt.getTime() + RATE_LIMIT_WINDOW_MS - Date.now()) / 1000),
      );
      throw new RateLimitExceededError(retryAfterSeconds);
    }

    const [inserted] = await db.insert(submissions).values({ enrollmentId, commitSha, status: 'queued' }).returning();

    return inserted;
  } finally {
    await pool.end();
  }
}
