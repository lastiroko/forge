import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { abandon, getEnrollment, getEnrollmentHistory, InvalidCombinationError, startChallenge } from './index.js';

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
  const result = await startChallenge(userId, challengeId, 'backend', enabledStackId, databaseUrl);
  enrollmentId = result.id;
  assert.equal(result.challengeVersionId, latestVersionId);
  assert.equal(result.status, 'active');
  assert.equal(result.repoUrl, null);
});

test('startChallenge rejects a stack not enabled for the challenge', async () => {
  await assert.rejects(
    startChallenge(userId, challengeId, 'backend', disabledStackId, databaseUrl),
    InvalidCombinationError,
  );
});

test('startChallenge rejects a mode not enabled for the challenge', async () => {
  await assert.rejects(
    startChallenge(userId, disabledModeChallengeId, 'fullstack', enabledStackId, databaseUrl),
    InvalidCombinationError,
  );
});

test('startChallenge reuses the active enrollment for the user and challenge', async () => {
  const first = await startChallenge(userId, challengeId, 'backend', enabledStackId, databaseUrl);
  const second = await startChallenge(userId, challengeId, 'backend', enabledStackId, databaseUrl);
  enrollmentId = first.id;
  assert.equal(second.id, first.id);
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
  const result = await startChallenge(userId, challengeId, 'backend', enabledStackId, databaseUrl);
  assert.notEqual(result.id, enrollmentId);
  assert.equal(result.status, 'active');
  enrollmentId = result.id;
});

test('abandon returns undefined for an id that is not an active enrollment', async () => {
  const result = await abandon(randomUUID(), databaseUrl);
  assert.equal(result, undefined);
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
    assert.equal(owner?.submissions.flatMap((submission) => submission.runs)[0].reportUrl.startsWith('https://reports.example/'), true);
    assert.ok(await getEnrollmentHistory(historyEnrollment.id, { id: randomUUID(), role: 'admin' }, databaseUrl));
    assert.equal(await getEnrollmentHistory(historyEnrollment.id, { id: randomUUID(), role: 'member' }, databaseUrl), undefined);
  } finally {
    for (const run of runs) await db.delete(gradingRuns).where(eq(gradingRuns.id, run.id));
    for (const submission of created) await db.delete(submissions).where(eq(submissions.id, submission.id));
    await db.delete(enrollments).where(eq(enrollments.id, historyEnrollment.id));
  }
});
