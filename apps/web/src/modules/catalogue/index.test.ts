import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { listChallenges, getChallenge, getVersion, getLatestPublishedVersion } from './index.js';

const { challenges, challengeVersions } = schema;
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

test('getLatestPublishedVersion returns the highest-numbered published version, ignoring a higher-numbered draft', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId;
  let versionOneId;
  let versionTwoId;
  let versionThreeId;
  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Multi-version challenge', level: 'junior' }).returning();
    challengeId = challenge.id;

    const [versionOne] = await db.insert(challengeVersions).values({
      challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    versionOneId = versionOne.id;

    const [versionTwo] = await db.insert(challengeVersions).values({
      challengeId, version: 2, level: 'junior', rubric: {}, openapiRef: 'openapi/v2.yaml', hiddenTestsRef: 'hidden/v2', publishedAt: new Date('2026-02-01T00:00:00Z'),
    }).returning();
    versionTwoId = versionTwo.id;

    const [versionThree] = await db.insert(challengeVersions).values({
      challengeId, version: 3, level: 'junior', rubric: {}, openapiRef: 'openapi/v3.yaml', hiddenTestsRef: 'hidden/v3',
    }).returning();
    versionThreeId = versionThree.id;

    const result = await getLatestPublishedVersion(challengeId, databaseUrl);

    assert.equal(result?.id, versionTwoId);
  } finally {
    if (versionOneId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionOneId));
    if (versionTwoId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionTwoId));
    if (versionThreeId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionThreeId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});
