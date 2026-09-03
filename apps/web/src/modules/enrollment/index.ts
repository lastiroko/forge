import { and, eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';
import {
  getChallenge,
  getEnabledStacks,
  getLatestPublishedVersion,
  type ChallengeVersion as CatalogueChallengeVersion,
  type Stack as CatalogueStack,
} from '../catalogue/index.js';
import { deliverStarterKit, type GitHubRepositoryClient, type ZipStorage } from '../kit-generator/index.js';

const { enrollments, challengeVersions } = schema;

export type Enrollment = typeof enrollments.$inferSelect;

export class InvalidCombinationError extends Error {
  constructor() {
    super('The selected mode and stack combination is not enabled for this challenge.');
    this.name = 'InvalidCombinationError';
  }
}

export class InvalidRepositoryUrlError extends Error {
  constructor() {
    super('The repository URL must be an absolute https://github.com/<owner>/<repo> URL.');
    this.name = 'InvalidRepositoryUrlError';
  }
}

export type BuildStarterFiles = (
  version: CatalogueChallengeVersion,
  stack: CatalogueStack,
  mode: 'backend' | 'fullstack',
) => Record<string, string>;

export interface StartChallengeDependencies {
  githubClient: GitHubRepositoryClient;
  zipStorage: ZipStorage;
  buildStarterFiles: BuildStarterFiles;
}

export interface StartChallengeResult {
  enrollment: Enrollment;
  repoUrl: string | null;
  downloadUrl: string | null;
}

export async function startChallenge(
  userId: string,
  challengeId: string,
  mode: 'backend' | 'fullstack',
  stackId: string,
  dependencies: StartChallengeDependencies,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<StartChallengeResult> {
  const challenge = await getChallenge(challengeId, databaseUrl);
  const modeEnabled = mode === 'backend' ? challenge?.backendEnabled : challenge?.fullstackEnabled;
  const enabledStacks = challenge ? await getEnabledStacks(challengeId, databaseUrl) : [];
  const stack = enabledStacks.find((candidate) => candidate.id === stackId);
  if (!challenge || !modeEnabled || !stack) {
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

    let enrollment = existing?.enrollment;
    if (!enrollment) {
      const [inserted] = await db.insert(enrollments).values({
        userId,
        challengeVersionId: version.id,
        mode,
        stackId,
        repoUrl: null,
        status: 'active',
      }).returning();
      enrollment = inserted;
    }

    if (enrollment.repoUrl) {
      return { enrollment, repoUrl: enrollment.repoUrl, downloadUrl: null };
    }

    const files = dependencies.buildStarterFiles(version, stack, mode);
    const delivery = await deliverStarterKit(enrollment.id, files, dependencies.githubClient, dependencies.zipStorage);

    if (delivery.repoUrl) {
      const [updated] = await db
        .update(enrollments)
        .set({ repoUrl: delivery.repoUrl })
        .where(eq(enrollments.id, enrollment.id))
        .returning();
      enrollment = updated;
    }

    return { enrollment, repoUrl: delivery.repoUrl, downloadUrl: delivery.downloadUrl };
  } finally {
    await pool.end();
  }
}

const GITHUB_REPO_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/;

export async function attachRepositoryUrl(
  enrollmentId: string,
  userId: string,
  repoUrl: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Enrollment | undefined> {
  if (!GITHUB_REPO_URL_PATTERN.test(repoUrl)) {
    throw new InvalidRepositoryUrlError();
  }

  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db
      .update(enrollments)
      .set({ repoUrl })
      .where(
        and(
          eq(enrollments.id, enrollmentId),
          eq(enrollments.userId, userId),
          eq(enrollments.status, 'active'),
        ),
      )
      .returning();
    return row;
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
