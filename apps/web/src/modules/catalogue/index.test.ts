import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { listChallenges, getChallenge, getVersion } from './index.js';

const { challenges, challengeVersions, challengeStacks, stacks } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

test('listChallenges returns only challenges that have a published version', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let draftChallengeId;
  let draftVersionId;
  let publishedChallengeId;
  let publishedVersionId;
  try {
    const [draftChallenge] = await db.insert(challenges).values({ title: 'Draft only challenge', level: 'junior' }).returning();
    draftChallengeId = draftChallenge.id;
    const [draftVersion] = await db.insert(challengeVersions).values({
      challengeId: draftChallengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1',
    }).returning();
    draftVersionId = draftVersion.id;

    const [publishedChallenge] = await db.insert(challenges).values({ title: 'Published challenge', level: 'junior' }).returning();
    publishedChallengeId = publishedChallenge.id;
    const [publishedVersion] = await db.insert(challengeVersions).values({
      challengeId: publishedChallengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    publishedVersionId = publishedVersion.id;

    const result = await listChallenges({}, databaseUrl);
    const resultIds = result.map((challenge) => challenge.id);

    assert.ok(resultIds.includes(publishedChallengeId));
    assert.ok(!resultIds.includes(draftChallengeId));
  } finally {
    if (draftVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, draftVersionId));
    if (publishedVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, publishedVersionId));
    if (draftChallengeId) await db.delete(challenges).where(eq(challenges.id, draftChallengeId));
    if (publishedChallengeId) await db.delete(challenges).where(eq(challenges.id, publishedChallengeId));
    await pool.end();
  }
});

test('getVersion returns the published version but not a draft version', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId;
  let publishedVersionId;
  let draftVersionId;
  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Versioned challenge', level: 'junior' }).returning();
    challengeId = challenge.id;

    const [published] = await db.insert(challengeVersions).values({
      challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    publishedVersionId = published.id;

    const [draft] = await db.insert(challengeVersions).values({
      challengeId, version: 2, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1',
    }).returning();
    draftVersionId = draft.id;

    const publishedResult = await getVersion(challengeId, 1, databaseUrl);
    assert.equal(publishedResult?.id, publishedVersionId);

    const draftResult = await getVersion(challengeId, 2, databaseUrl);
    assert.equal(draftResult, undefined);
  } finally {
    if (publishedVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, publishedVersionId));
    if (draftVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, draftVersionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});

test('getChallenge returns the challenge row by id', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId;
  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Lookup challenge', level: 'mid' }).returning();
    challengeId = challenge.id;

    const result = await getChallenge(challengeId, databaseUrl);

    assert.equal(result?.id, challengeId);
    assert.equal(result?.title, 'Lookup challenge');
  } finally {
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});

test('listChallenges returns enabled stacks and basePoints for a challenge', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId: string | undefined;
  let versionId: string | undefined;
  let stackAId: string | undefined;
  let stackBId: string | undefined;
  let challengeStackAId: string | undefined;
  let challengeStackBId: string | undefined;
  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Stacked challenge', level: 'junior' }).returning();
    challengeId = challenge.id;
    const [version] = await db.insert(challengeVersions).values({
      challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    versionId = version.id;

    const [stackA] = await db.insert(stacks).values({ language: 'TypeScript', framework: 'Express' }).returning();
    stackAId = stackA.id;
    const [stackB] = await db.insert(stacks).values({ language: 'Go', framework: 'Fiber' }).returning();
    stackBId = stackB.id;

    const [challengeStackA] = await db.insert(challengeStacks).values({ challengeId, stackId: stackAId }).returning();
    challengeStackAId = challengeStackA.id;
    const [challengeStackB] = await db.insert(challengeStacks).values({ challengeId, stackId: stackBId }).returning();
    challengeStackBId = challengeStackB.id;

    const result = await listChallenges({}, databaseUrl);
    const found = result.find((c) => c.id === challengeId);

    assert.ok(found);
    assert.equal(found?.basePoints, 100);
    const enabledStackIds = found?.enabledStacks.map((s) => s.id) ?? [];
    assert.ok(enabledStackIds.includes(stackAId));
    assert.ok(enabledStackIds.includes(stackBId));
  } finally {
    if (challengeStackAId) await db.delete(challengeStacks).where(eq(challengeStacks.id, challengeStackAId));
    if (challengeStackBId) await db.delete(challengeStacks).where(eq(challengeStacks.id, challengeStackBId));
    if (stackAId) await db.delete(stacks).where(eq(stacks.id, stackAId));
    if (stackBId) await db.delete(stacks).where(eq(stacks.id, stackBId));
    if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});

test('listChallenges({ level: "junior" }) excludes a mid-level challenge', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let juniorId: string | undefined;
  let juniorVersionId: string | undefined;
  let midId: string | undefined;
  let midVersionId: string | undefined;
  try {
    const [junior] = await db.insert(challenges).values({ title: 'Level filter junior', level: 'junior' }).returning();
    juniorId = junior.id;
    const [juniorVersion] = await db.insert(challengeVersions).values({
      challengeId: juniorId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    juniorVersionId = juniorVersion.id;

    const [mid] = await db.insert(challenges).values({ title: 'Level filter mid', level: 'mid' }).returning();
    midId = mid.id;
    const [midVersion] = await db.insert(challengeVersions).values({
      challengeId: midId, version: 1, level: 'mid', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    midVersionId = midVersion.id;

    const result = await listChallenges({ level: 'junior' }, databaseUrl);
    const resultIds = result.map((c) => c.id);

    assert.ok(resultIds.includes(juniorId));
    assert.ok(!resultIds.includes(midId));
  } finally {
    if (juniorVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, juniorVersionId));
    if (midVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, midVersionId));
    if (juniorId) await db.delete(challenges).where(eq(challenges.id, juniorId));
    if (midId) await db.delete(challenges).where(eq(challenges.id, midId));
    await pool.end();
  }
});

test('listChallenges({ mode: "fullstack" }) excludes a backend-only challenge', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let backendOnlyId: string | undefined;
  let backendOnlyVersionId: string | undefined;
  let fullstackId: string | undefined;
  let fullstackVersionId: string | undefined;
  try {
    const [backendOnly] = await db.insert(challenges).values({ title: 'Mode filter backend only', level: 'junior', fullstackEnabled: false }).returning();
    backendOnlyId = backendOnly.id;
    const [backendOnlyVersion] = await db.insert(challengeVersions).values({
      challengeId: backendOnlyId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    backendOnlyVersionId = backendOnlyVersion.id;

    const [fullstack] = await db.insert(challenges).values({ title: 'Mode filter fullstack', level: 'junior', fullstackEnabled: true }).returning();
    fullstackId = fullstack.id;
    const [fullstackVersion] = await db.insert(challengeVersions).values({
      challengeId: fullstackId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    fullstackVersionId = fullstackVersion.id;

    const result = await listChallenges({ mode: 'fullstack' }, databaseUrl);
    const resultIds = result.map((c) => c.id);

    assert.ok(resultIds.includes(fullstackId));
    assert.ok(!resultIds.includes(backendOnlyId));
  } finally {
    if (backendOnlyVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, backendOnlyVersionId));
    if (fullstackVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, fullstackVersionId));
    if (backendOnlyId) await db.delete(challenges).where(eq(challenges.id, backendOnlyId));
    if (fullstackId) await db.delete(challenges).where(eq(challenges.id, fullstackId));
    await pool.end();
  }
});

test('listChallenges() always returns completionCount 0', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId: string | undefined;
  let versionId: string | undefined;
  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Completion count challenge', level: 'senior' }).returning();
    challengeId = challenge.id;
    const [version] = await db.insert(challengeVersions).values({
      challengeId, version: 1, level: 'senior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    versionId = version.id;

    const result = await listChallenges({}, databaseUrl);

    assert.ok(result.length > 0);
    assert.ok(result.every((c) => c.completionCount === 0));
  } finally {
    if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});
