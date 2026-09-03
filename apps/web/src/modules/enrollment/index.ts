import { and, asc, desc, eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';
import {
  getChallenge,
  getEnabledStacks,
  getLatestPublishedVersion,
} from '../catalogue/index.js';

const { enrollments, challengeVersions, submissions, gradingRuns } = schema;

export type Enrollment = typeof enrollments.$inferSelect;

export async function listAccountExportEnrollments(
  userId: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Enrollment[]> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    return await db.select().from(enrollments)
      .where(eq(enrollments.userId, userId))
      .orderBy(asc(enrollments.createdAt), asc(enrollments.id));
  } finally {
    await pool.end();
  }
}

export interface EnrollmentHistoryRun {
  id: string;
  status: string;
  score: number | null;
  reportUrl: string | null;
  buildLogUrl: string | null;
  appLogUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnrollmentHistorySubmission {
  id: string;
  commitSha: string;
  status: string;
  createdAt: Date;
  runs: EnrollmentHistoryRun[];
}

export interface EnrollmentHistory {
  enrollment: Enrollment;
  submissions: EnrollmentHistorySubmission[];
}

export async function getEnrollmentHistory(
  id: string,
  viewer: { id: string; role: string },
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<EnrollmentHistory | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [enrollment] = await db.select().from(enrollments).where(eq(enrollments.id, id));
    if (!enrollment || (viewer.role !== 'admin' && viewer.id !== enrollment.userId)) return undefined;

    const rows = await db.select({ submission: submissions, run: gradingRuns })
      .from(submissions)
      .leftJoin(gradingRuns, eq(gradingRuns.submissionId, submissions.id))
      .where(eq(submissions.enrollmentId, id))
      .orderBy(desc(submissions.createdAt), desc(submissions.id), desc(gradingRuns.createdAt), desc(gradingRuns.id));
    const history: EnrollmentHistorySubmission[] = [];
    for (const row of rows) {
      let submission = history.find((entry) => entry.id === row.submission.id);
      if (!submission) {
        submission = { ...row.submission, runs: [] };
        history.push(submission);
      }
      if (row.run) submission.runs.push({
        id: row.run.id,
        status: row.run.status,
        score: row.run.score,
        reportUrl: row.run.reportUrl,
        buildLogUrl: row.run.buildLogUrl,
        appLogUrl: row.run.appLogUrl,
        createdAt: row.run.createdAt,
        updatedAt: row.run.updatedAt,
      });
    }
    return { enrollment, submissions: history };
  } finally {
    await pool.end();
  }
}

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
