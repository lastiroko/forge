import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { challenges, challengeVersions, enrollments } from './schema.js';

test('rejects rubric updates to a published challenge version', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  const challengeId = randomUUID();
  const challengeVersionId = randomUUID();
  const originalRubric = { criteria: ['correctness'] };
  try {
    await db
      .insert(challenges)
      .values({ id: challengeId, title: `Immutable challenge ${challengeId}`, level: 'junior' });

    await db.insert(challengeVersions).values({
      id: challengeVersionId,
      challengeId,
      version: 1,
      level: 'junior',
      rubric: originalRubric,
      openapiRef: `openapi/${challengeId}/v1.yaml`,
      hiddenTestsRef: `hidden/${challengeId}/v1`,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await assert.rejects(
      async () => {
        await db
          .update(challengeVersions)
          .set({ rubric: { criteria: ['changed'] } })
          .where(eq(challengeVersions.id, challengeVersionId));
      },
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, /published challenge versions are immutable/);
        return true;
      },
    );

    const [storedVersion] = await db
      .select()
      .from(challengeVersions)
      .where(eq(challengeVersions.id, challengeVersionId));

    assert.deepEqual(storedVersion.rubric, originalRubric);
  } finally {
    await db.delete(challengeVersions).where(eq(challengeVersions.id, challengeVersionId));
    await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});

test('publishing a new version preserves an existing enrollment version id', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  const challengeId = randomUUID();
  const firstVersionId = randomUUID();
  const secondVersionId = randomUUID();
  const enrollmentId = randomUUID();
  try {
    await db
      .insert(challenges)
      .values({ id: challengeId, title: `Versioned challenge ${challengeId}`, level: 'junior' });

    await db.insert(challengeVersions).values({
      id: firstVersionId,
      challengeId,
      version: 1,
      level: 'junior',
      rubric: { criteria: ['version 1'] },
      openapiRef: `openapi/${challengeId}/v1.yaml`,
      hiddenTestsRef: `hidden/${challengeId}/v1`,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await db.insert(enrollments).values({
      id: enrollmentId,
      userId: randomUUID(),
      challengeVersionId: firstVersionId,
      mode: 'backend',
      stackId: randomUUID(),
      status: 'pending',
    });

    await db.insert(challengeVersions).values({
      id: secondVersionId,
      challengeId,
      version: 2,
      level: 'junior',
      rubric: { criteria: ['version 2'] },
      openapiRef: `openapi/${challengeId}/v2.yaml`,
      hiddenTestsRef: `hidden/${challengeId}/v2`,
      publishedAt: new Date('2026-02-01T00:00:00Z'),
    });

    const [storedEnrollment] = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, enrollmentId));

    assert.equal(storedEnrollment.challengeVersionId, firstVersionId);
  } finally {
    await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    await db.delete(challengeVersions).where(eq(challengeVersions.id, secondVersionId));
    await db.delete(challengeVersions).where(eq(challengeVersions.id, firstVersionId));
    await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});
