import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import type { GitHubRepositoryClient, ZipStorage } from '../kit-generator/index.js';
import {
  abandon,
  attachRepositoryUrl,
  getEnrollment,
  InvalidCombinationError,
  InvalidRepositoryUrlError,
  startChallenge,
  type StartChallengeDependencies,
} from './index.js';

const failingGithubClient: GitHubRepositoryClient = {
  async createRepository() {
    throw new Error('GitHub is unavailable in tests');
  },
};

const fakeZipStorage: ZipStorage = {
  async upload(key: string) {
    return `https://storage.example.com/${key}`;
  },
};

const fallbackDependencies: StartChallengeDependencies = {
  githubClient: failingGithubClient,
  zipStorage: fakeZipStorage,
  buildStarterFiles: () => ({ 'README.md': 'stub starter kit' }),
};

const succeedingDependencies: StartChallengeDependencies = {
  githubClient: {
    async createRepository() {
      return 'https://github.com/example/generated-repo';
    },
  },
  zipStorage: fakeZipStorage,
  buildStarterFiles: () => ({ 'README.md': 'stub starter kit' }),
};

const { users, challenges, challengeVersions, stacks, challengeStacks, enrollments } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const { db, pool } = createDbClient(databaseUrl);

let userId: string;
let challengeId: string;
let disabledModeChallengeId: string;
let latestVersionId: string;
let enabledStackId: string;
let disabledStackId: string;
let enrollmentId: string;
const versionIds: string[] = [];
const challengeStackIds: string[] = [];

before(async () => {
  const [user] = await db.insert(users).values({
    githubId: Date.now(), handle: `enrollment-${Date.now()}`, displayName: 'Enrollment Test', email: `enrollment-${Date.now()}@example.com`, role: 'member',
  }).returning();
  userId = user.id;
  const [challenge] = await db.insert(challenges).values({ title: 'Enrollment challenge', level: 'junior', backendEnabled: true, fullstackEnabled: false }).returning();
  challengeId = challenge.id;
  const [disabledModeChallenge] = await db.insert(challenges).values({ title: 'Disabled mode challenge', level: 'junior', backendEnabled: true, fullstackEnabled: false }).returning();
  disabledModeChallengeId = disabledModeChallenge.id;
  const [enabledStack] = await db.insert(stacks).values({ language: 'TypeScript', framework: 'Express' }).returning();
  enabledStackId = enabledStack.id;
  const [disabledStack] = await db.insert(stacks).values({ language: 'Go', framework: 'Fiber' }).returning();
  disabledStackId = disabledStack.id;

  for (const targetChallengeId of [challengeId, disabledModeChallengeId]) {
    const [challengeStack] = await db.insert(challengeStacks).values({ challengeId: targetChallengeId, stackId: enabledStackId }).returning();
    challengeStackIds.push(challengeStack.id);
    const [version] = await db.insert(challengeVersions).values({
      challengeId: targetChallengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    versionIds.push(version.id);
  }
  const [latestVersion] = await db.insert(challengeVersions).values({
    challengeId, version: 2, level: 'junior', rubric: {}, openapiRef: 'openapi/v2.yaml', hiddenTestsRef: 'hidden/v2', publishedAt: new Date('2026-02-01T00:00:00Z'),
  }).returning();
  latestVersionId = latestVersion.id;
  versionIds.push(latestVersion.id);
});

after(async () => {
  if (userId) await db.delete(enrollments).where(eq(enrollments.userId, userId));
  for (const id of challengeStackIds) await db.delete(challengeStacks).where(eq(challengeStacks.id, id));
  for (const id of versionIds) await db.delete(challengeVersions).where(eq(challengeVersions.id, id));
  if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
  if (disabledModeChallengeId) await db.delete(challenges).where(eq(challenges.id, disabledModeChallengeId));
  if (enabledStackId) await db.delete(stacks).where(eq(stacks.id, enabledStackId));
  if (disabledStackId) await db.delete(stacks).where(eq(stacks.id, disabledStackId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

test('startChallenge creates an active enrollment for the latest published version', async () => {
  const result = await startChallenge(userId, challengeId, 'backend', enabledStackId, fallbackDependencies, databaseUrl);
  enrollmentId = result.enrollment.id;
  assert.equal(result.enrollment.challengeVersionId, latestVersionId);
  assert.equal(result.enrollment.status, 'active');
  assert.equal(result.enrollment.repoUrl, null);
});

test('startChallenge rejects a stack not enabled for the challenge', async () => {
  await assert.rejects(
    startChallenge(userId, challengeId, 'backend', disabledStackId, fallbackDependencies, databaseUrl),
    InvalidCombinationError,
  );
});

test('startChallenge rejects a mode not enabled for the challenge', async () => {
  await assert.rejects(
    startChallenge(userId, disabledModeChallengeId, 'fullstack', enabledStackId, fallbackDependencies, databaseUrl),
    InvalidCombinationError,
  );
});

test('startChallenge reuses the active enrollment for the user and challenge', async () => {
  const first = await startChallenge(userId, challengeId, 'backend', enabledStackId, fallbackDependencies, databaseUrl);
  const second = await startChallenge(userId, challengeId, 'backend', enabledStackId, fallbackDependencies, databaseUrl);
  enrollmentId = first.enrollment.id;
  assert.equal(second.enrollment.id, first.enrollment.id);
});

test('getEnrollment returns a row by id and undefined for an unknown id', async () => {
  const existing = await getEnrollment(enrollmentId, databaseUrl);
  const missing = await getEnrollment(randomUUID(), databaseUrl);
  assert.equal(existing?.id, enrollmentId);
  assert.equal(missing, undefined);
});

test('abandon marks the active enrollment as abandoned', async () => {
  const result = await abandon(enrollmentId, databaseUrl);
  assert.equal(result?.id, enrollmentId);
  assert.equal(result?.status, 'abandoned');
});

test('startChallenge creates a new enrollment after the previous one was abandoned', async () => {
  const result = await startChallenge(userId, challengeId, 'backend', enabledStackId, fallbackDependencies, databaseUrl);
  assert.notEqual(result.enrollment.id, enrollmentId);
  assert.equal(result.enrollment.status, 'active');
  enrollmentId = result.enrollment.id;
});

test('startChallenge falls back to a zip download when the GitHub client fails', async () => {
  const result = await startChallenge(userId, challengeId, 'backend', enabledStackId, fallbackDependencies, databaseUrl);
  assert.equal(result.enrollment.status, 'active');
  assert.equal(result.repoUrl, null);
  assert.equal(result.enrollment.repoUrl, null);
  assert.match(result.downloadUrl ?? '', /^https:\/\//);
});

test('startChallenge persists the repository URL when GitHub creation succeeds', async () => {
  const result = await abandon(enrollmentId, databaseUrl);
  assert.equal(result?.status, 'abandoned');

  const started = await startChallenge(userId, challengeId, 'backend', enabledStackId, succeedingDependencies, databaseUrl);
  enrollmentId = started.enrollment.id;
  assert.equal(started.repoUrl, 'https://github.com/example/generated-repo');
  assert.equal(started.downloadUrl, null);
  assert.equal(started.enrollment.repoUrl, 'https://github.com/example/generated-repo');

  const reloaded = await getEnrollment(enrollmentId, databaseUrl);
  assert.equal(reloaded?.repoUrl, 'https://github.com/example/generated-repo');
});

test('attachRepositoryUrl updates repo_url for the owning member on an active enrollment', async () => {
  await abandon(enrollmentId, databaseUrl);
  const started = await startChallenge(userId, challengeId, 'backend', enabledStackId, fallbackDependencies, databaseUrl);
  enrollmentId = started.enrollment.id;
  assert.equal(started.enrollment.repoUrl, null);

  const updated = await attachRepositoryUrl(enrollmentId, userId, 'https://github.com/example/starter-kit', databaseUrl);
  assert.equal(updated?.repoUrl, 'https://github.com/example/starter-kit');

  const reloaded = await getEnrollment(enrollmentId, databaseUrl);
  assert.equal(reloaded?.repoUrl, 'https://github.com/example/starter-kit');
});

test('attachRepositoryUrl rejects an invalid or non-GitHub URL', async () => {
  await assert.rejects(
    attachRepositoryUrl(enrollmentId, userId, 'not-a-url', databaseUrl),
    InvalidRepositoryUrlError,
  );
  await assert.rejects(
    attachRepositoryUrl(enrollmentId, userId, 'https://gitlab.com/example/starter-kit', databaseUrl),
    InvalidRepositoryUrlError,
  );
});

test('attachRepositoryUrl rejects an enrollment owned by another member', async () => {
  const [otherUser] = await db.insert(users).values({
    githubId: Date.now() + 1, handle: `enrollment-other-${Date.now()}`, displayName: 'Other Member', email: `enrollment-other-${Date.now()}@example.com`, role: 'member',
  }).returning();
  try {
    const result = await attachRepositoryUrl(enrollmentId, otherUser.id, 'https://github.com/example/attacker-repo', databaseUrl);
    assert.equal(result, undefined);

    const reloaded = await getEnrollment(enrollmentId, databaseUrl);
    assert.notEqual(reloaded?.repoUrl, 'https://github.com/example/attacker-repo');
  } finally {
    await db.delete(users).where(eq(users.id, otherUser.id));
  }
});

test('attachRepositoryUrl rejects an abandoned enrollment', async () => {
  const abandoned = await abandon(enrollmentId, databaseUrl);
  assert.equal(abandoned?.status, 'abandoned');

  const result = await attachRepositoryUrl(enrollmentId, userId, 'https://github.com/example/starter-kit', databaseUrl);
  assert.equal(result, undefined);
});

test('abandon returns undefined for an id that is not an active enrollment', async () => {
  const result = await abandon(randomUUID(), databaseUrl);
  assert.equal(result, undefined);
});
