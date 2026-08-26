import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import ChallengeDetailPage from './page.js';

const { challenges, challengeVersions } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

test('challenge detail page returns the brief and the four rubric weights for a published challenge', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId;
  let versionId;
  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Items API', level: 'junior' }).returning();
    challengeId = challenge.id;
    const [version] = await db.insert(challengeVersions).values({
      challengeId,
      version: 1,
      level: 'junior',
      brief: 'Build a small items API with full CRUD.',
      rubric: { functional: 60, contract: 15, robustness: 15, quality: 10 },
      openapiRef: 'openapi/v1.yaml',
      hiddenTestsRef: 'hidden/v1',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    versionId = version.id;

    const element = await ChallengeDetailPage({ params: { id: challengeId } });
    const html = renderToStaticMarkup(element);

    assert.match(html, /Build a small items API with full CRUD\./);
    assert.match(html, /<dd>60<\/dd>/);
    assert.match(html, /<dd>15<\/dd>/);
    assert.match(html, /<dd>10<\/dd>/);
  } finally {
    if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});

test('challenge detail page calls notFound when the challenge has no published version', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId;
  let versionId;
  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Draft only challenge', level: 'junior' }).returning();
    challengeId = challenge.id;
    const [version] = await db.insert(challengeVersions).values({
      challengeId,
      version: 1,
      level: 'junior',
      brief: 'Not visible yet.',
      rubric: { functional: 60, contract: 15, robustness: 15, quality: 10 },
      openapiRef: 'openapi/v1.yaml',
      hiddenTestsRef: 'hidden/v1',
    }).returning();
    versionId = version.id;

    await assert.rejects(
      () => ChallengeDetailPage({ params: { id: challengeId } }),
      (error) => (error as { digest?: string }).digest === 'NEXT_NOT_FOUND',
    );
  } finally {
    if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});
