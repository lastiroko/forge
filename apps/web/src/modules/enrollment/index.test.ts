import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { createDbClient, schema } from '@forge/db';
import { generateStarterKit, type GitHubRepositoryClient, type ZipStorage } from '../kit-generator/index.js';
import {
  abandon,
  attachRepositoryUrl,
  getEnrollment,
  getEnrollmentHistory,
  InvalidCombinationError,
  startChallenge,
  type BuildStarterFiles,
} from './index.js';

const { users, challenges, challengeVersions, stacks, challengeStacks, enrollments, submissions, gradingRuns } = schema;
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
const repositoryUrl = 'https://github.com/enrollment-test/todo-api';

const createCalls: Array<{ enrollmentId: string; files: Record<string, string> }> = [];
const githubClient: GitHubRepositoryClient = {
  async createRepository(input) {
    createCalls.push(input);
    return repositoryUrl;
  },
};
const failingGithubClient: GitHubRepositoryClient = {
  async createRepository() {
    throw new Error('GitHub is unavailable');
  },
};

const zipUploads: Array<{ key: string; zip: Buffer }> = [];
const zipStorage: ZipStorage = {
  async upload(key, zip) {
    zipUploads.push({ key, zip });
    return `https://storage.example.com/${key}`;
  },
  async read() {
    return undefined;
  },
};

let buildStarterFiles: BuildStarterFiles;

before(async () => {
  const [user] = await db.insert(users).values({
    githubId: Date.now(), handle: `enrollment-${Date.now()}`, displayName: 'Enrollment Test', email: `enrollment-${Date.now()}@example.com`, role: 'member',
  }).returning();
  userId = user.id;
  const [challenge] = await db.insert(challenges).values({ title: 'Enrollment challenge', level: 'junior', backendEnabled: true, fullstackEnabled: false, contentSlug: 'todo-api' }).returning();
  challengeId = challenge.id;
  const [disabledModeChallenge] = await db.insert(challenges).values({ title: 'Disabled mode challenge', level: 'junior', backendEnabled: true, fullstackEnabled: false }).returning();
  disabledModeChallengeId = disabledModeChallenge.id;
  const [enabledStack] = await db.insert(stacks).values({ language: 'Python', framework: 'FastAPI', templateKey: 'python-fastapi' }).returning();
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

  buildStarterFiles = (_version, stack, mode) => generateStarterKit(challenge, stack, mode);
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

test('startChallenge creates an active enrollment with a GitHub repository when creation succeeds', async () => {
  const result = await startChallenge(userId, challengeId, 'backend', enabledStackId, { githubClient, zipStorage, buildStarterFiles }, databaseUrl);
  enrollmentId = result.enrollment.id;
  assert.equal(result.enrollment.challengeVersionId, latestVersionId);
  assert.equal(result.enrollment.status, 'active');
  assert.equal(result.repoUrl, repositoryUrl);
  assert.equal(result.downloadUrl, null);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].enrollmentId, result.enrollment.id);

  const [challenge] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
  const [stack] = await db.select().from(stacks).where(eq(stacks.id, enabledStackId));
  assert.deepEqual(createCalls[0].files, generateStarterKit(challenge, stack, 'backend'));
  assert.deepEqual(Object.keys(createCalls[0].files).sort(), [
    '.github/workflows/checks.yml',
    'Dockerfile',
    'README.md',
    'app/routes/deleteItemsById.py',
    'app/routes/getHealth.py',
    'app/routes/getItems.py',
    'app/routes/getItemsById.py',
    'app/routes/patchItemsById.py',
    'app/routes/postItems.py',
    'challenge.yml',
    'checks/functional-public.json',
    'docker-compose.yml',
    'openapi.yaml',
  ]);
  assert.equal(zipUploads.length, 0);

  const [persisted] = await db.select().from(enrollments).where(eq(enrollments.id, result.enrollment.id));
  assert.equal(persisted.repoUrl, repositoryUrl);
  assert.equal(persisted.status, 'active');
});

test('startChallenge rejects a stack not enabled for the challenge', async () => {
  await assert.rejects(
    startChallenge(userId, challengeId, 'backend', disabledStackId, { githubClient, zipStorage, buildStarterFiles }, databaseUrl),
    InvalidCombinationError,
  );
});

test('startChallenge rejects a mode not enabled for the challenge', async () => {
  await assert.rejects(
    startChallenge(userId, disabledModeChallengeId, 'fullstack', enabledStackId, { githubClient, zipStorage, buildStarterFiles }, databaseUrl),
    InvalidCombinationError,
  );
});

test('startChallenge reuses the active enrollment for the user and challenge', async () => {
  const callsBefore = { create: createCalls.length, upload: zipUploads.length };
  const first = await startChallenge(userId, challengeId, 'backend', enabledStackId, { githubClient, zipStorage, buildStarterFiles }, databaseUrl);
  const second = await startChallenge(userId, challengeId, 'backend', enabledStackId, { githubClient, zipStorage, buildStarterFiles }, databaseUrl);
  enrollmentId = first.enrollment.id;
  assert.equal(second.enrollment.id, first.enrollment.id);
  assert.equal(createCalls.length, callsBefore.create);
  assert.equal(zipUploads.length, callsBefore.upload);
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

test('startChallenge falls back to a zip download when no GitHub client is configured', async () => {
  const callsBefore = createCalls.length;
  const result = await startChallenge(userId, challengeId, 'backend', enabledStackId, { zipStorage, buildStarterFiles }, databaseUrl);
  assert.notEqual(result.enrollment.id, enrollmentId);
  assert.equal(result.enrollment.status, 'active');
  assert.equal(result.repoUrl, null);
  assert.equal(result.downloadUrl, `/starter-kits/${result.enrollment.id}`);
  assert.equal(createCalls.length, callsBefore);

  const upload = zipUploads.at(-1);
  assert.equal(upload?.key, `starter-kits/${result.enrollment.id}.zip`);
  const [challenge] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
  const [stack] = await db.select().from(stacks).where(eq(stacks.id, enabledStackId));
  const expectedFiles = generateStarterKit(challenge, stack, 'backend');
  const zip = await JSZip.loadAsync(upload!.zip);
  assert.deepEqual(Object.keys(zip.files).sort(), Object.keys(expectedFiles).sort());
  for (const [filePath, content] of Object.entries(expectedFiles)) {
    assert.equal(await zip.file(filePath)?.async('string'), content);
  }

  const [persisted] = await db.select().from(enrollments).where(eq(enrollments.id, result.enrollment.id));
  assert.equal(persisted.repoUrl, null);
  assert.equal(persisted.status, 'active');

  await abandon(result.enrollment.id, databaseUrl);
});

test('startChallenge falls back to a zip download when the GitHub client rejects', async () => {
  const result = await startChallenge(userId, challengeId, 'backend', enabledStackId, { githubClient: failingGithubClient, zipStorage, buildStarterFiles }, databaseUrl);
  assert.equal(result.enrollment.status, 'active');
  assert.equal(result.repoUrl, null);
  assert.equal(result.downloadUrl, `/starter-kits/${result.enrollment.id}`);

  const upload = zipUploads.find((entry) => entry.key === `starter-kits/${result.enrollment.id}.zip`);
  assert.ok(upload);

  const [persisted] = await db.select().from(enrollments).where(eq(enrollments.id, result.enrollment.id));
  assert.equal(persisted.repoUrl, null);

  enrollmentId = result.enrollment.id;
});

test('attachRepositoryUrl rejects a malformed URL without changing repo_url', async () => {
  const result = await attachRepositoryUrl(enrollmentId, userId, 'not-a-url', databaseUrl);
  assert.equal(result, undefined);
  const [persisted] = await db.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
  assert.equal(persisted.repoUrl, null);
});

test('attachRepositoryUrl rejects a non-HTTPS URL', async () => {
  const result = await attachRepositoryUrl(enrollmentId, userId, 'http://github.com/example/starter-kit', databaseUrl);
  assert.equal(result, undefined);
});

test('attachRepositoryUrl rejects a URL that is not on github.com', async () => {
  const result = await attachRepositoryUrl(enrollmentId, userId, 'https://gitlab.com/example/starter-kit', databaseUrl);
  assert.equal(result, undefined);
});

test('attachRepositoryUrl rejects an enrollment owned by another member', async () => {
  const result = await attachRepositoryUrl(enrollmentId, randomUUID(), 'https://github.com/example/starter-kit', databaseUrl);
  assert.equal(result, undefined);
  const [persisted] = await db.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
  assert.equal(persisted.repoUrl, null);
});

test('attachRepositoryUrl rejects an enrollment that is not active', async () => {
  const [abandoned] = await db.insert(enrollments).values({
    userId, challengeVersionId: latestVersionId, mode: 'backend', stackId: enabledStackId, status: 'abandoned',
  }).returning();
  try {
    const result = await attachRepositoryUrl(abandoned.id, userId, 'https://github.com/example/starter-kit', databaseUrl);
    assert.equal(result, undefined);
  } finally {
    await db.delete(enrollments).where(eq(enrollments.id, abandoned.id));
  }
});

test('attachRepositoryUrl persists a canonical GitHub repository URL for the active enrollment owner', async () => {
  const result = await attachRepositoryUrl(enrollmentId, userId, 'https://github.com/example/starter-kit', databaseUrl);
  assert.equal(result?.repoUrl, 'https://github.com/example/starter-kit');

  const reloaded = await getEnrollment(enrollmentId, databaseUrl);
  assert.equal(reloaded?.repoUrl, 'https://github.com/example/starter-kit');
});

test('getEnrollmentHistory authorizes owner and admin and retains submissions without runs', async () => {
  const [historyEnrollment] = await db.insert(enrollments).values({
    userId, challengeVersionId: latestVersionId, mode: 'backend', stackId: enabledStackId, status: 'active',
  }).returning();
  const created = await db.insert(submissions).values([
    { enrollmentId: historyEnrollment.id, commitSha: 'history-40', status: 'successful' },
    { enrollmentId: historyEnrollment.id, commitSha: 'history-90', status: 'successful' },
    { enrollmentId: historyEnrollment.id, commitSha: 'history-pending', status: 'queued' },
  ]).returning();
  const runs = await db.insert(gradingRuns).values(created.slice(0, 2).map((submission, index) => ({
    submissionId: submission.id, status: 'successful', score: index ? 90 : 40,
    reportUrl: `https://reports.example/${index}`, buildLogUrl: `https://build.example/${index}`,
    appLogUrl: `https://app.example/${index}`,
  }))).returning();
  try {
    const owner = await getEnrollmentHistory(historyEnrollment.id, { id: userId, role: 'member' }, databaseUrl);
    assert.equal(owner?.submissions.length, 3);
    assert.deepEqual(owner?.submissions.flatMap((submission) => submission.runs.map((run) => run.score)).sort(), [40, 90]);
    assert.ok(owner?.submissions.some((submission) => submission.runs.length === 0));
    const firstRun = owner?.submissions.flatMap((submission) => submission.runs)[0];
    assert.ok(firstRun?.reportUrl?.startsWith('https://reports.example/'));
    assert.ok(await getEnrollmentHistory(historyEnrollment.id, { id: randomUUID(), role: 'admin' }, databaseUrl));
    assert.equal(await getEnrollmentHistory(historyEnrollment.id, { id: randomUUID(), role: 'member' }, databaseUrl), undefined);
  } finally {
    for (const run of runs) await db.delete(gradingRuns).where(eq(gradingRuns.id, run.id));
    for (const submission of created) await db.delete(submissions).where(eq(submissions.id, submission.id));
    await db.delete(enrollments).where(eq(enrollments.id, historyEnrollment.id));
  }
});
