import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { getEnrollment, InvalidCombinationError, startChallenge } from './index.js';

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
