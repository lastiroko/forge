import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { eq, and, isNotNull } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { challenges, challengeVersions } from './schema.js';

test('inserts a challenge with two versions and reads back only the published one by id+version', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId;
  let publishedVersionId;
  let draftVersionId;
  try {
    const [challenge] = await db
      .insert(challenges)
      .values({ title: 'Test challenge', level: 'junior' })
      .returning();
    challengeId = challenge.id;

    const [published] = await db
      .insert(challengeVersions)
      .values({
        challengeId,
        version: 1,
        level: 'junior',
        rubric: {},
        openapiRef: 'openapi/v1.yaml',
        hiddenTestsRef: 'hidden/v1',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
      })
      .returning();
    publishedVersionId = published.id;

    const [draft] = await db
      .insert(challengeVersions)
      .values({
        challengeId,
        version: 2,
        level: 'junior',
        rubric: {},
        openapiRef: 'openapi/v1.yaml',
        hiddenTestsRef: 'hidden/v1',
      })
      .returning();
    draftVersionId = draft.id;

    const publishedRows = await db
      .select()
      .from(challengeVersions)
      .where(
        and(
          eq(challengeVersions.challengeId, challengeId),
          eq(challengeVersions.version, 1),
          isNotNull(challengeVersions.publishedAt),
        ),
      );

    assert.equal(publishedRows.length, 1);
    assert.equal(publishedRows[0].id, publishedVersionId);

    const draftRows = await db
      .select()
      .from(challengeVersions)
      .where(
        and(
          eq(challengeVersions.challengeId, challengeId),
          eq(challengeVersions.version, 2),
          isNotNull(challengeVersions.publishedAt),
        ),
      );

    assert.equal(draftRows.length, 0);
  } finally {
    if (publishedVersionId) {
      await db.delete(challengeVersions).where(eq(challengeVersions.id, publishedVersionId));
    }
    if (draftVersionId) {
      await db.delete(challengeVersions).where(eq(challengeVersions.id, draftVersionId));
    }
    if (challengeId) {
      await db.delete(challenges).where(eq(challenges.id, challengeId));
    }
    await pool.end();
  }
});
