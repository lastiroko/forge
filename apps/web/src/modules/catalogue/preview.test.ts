import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { getDraftVersionForPreview } from './index.js';

const { challenges, challengeVersions, challengeStacks, stacks } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

test('getDraftVersionForPreview returns the owning challenge and only its linked stacks for a draft version', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId = '';
  let draftVersionId: string | undefined;
  let linkedStackId: string | undefined;
  let unlinkedStackId: string | undefined;
  let challengeStackId: string | undefined;
  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Preview draft challenge', level: 'junior', contentSlug: 'todo-api' }).returning();
    challengeId = challenge.id;
    const [draft] = await db.insert(challengeVersions).values({
      challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1',
    }).returning();
    draftVersionId = draft.id;

    const [linkedStack] = await db.insert(stacks).values({ language: 'Python', framework: 'FastAPI', templateKey: 'python-fastapi' }).returning();
    linkedStackId = linkedStack.id;
    const [unlinkedStack] = await db.insert(stacks).values({ language: 'Go', framework: 'Fiber', templateKey: 'go-fiber' }).returning();
    unlinkedStackId = unlinkedStack.id;
    const [challengeStack] = await db.insert(challengeStacks).values({ challengeId, stackId: linkedStackId }).returning();
    challengeStackId = challengeStack.id;

    const result = await getDraftVersionForPreview(challengeId, 1, databaseUrl);

    assert.ok(result);
    assert.equal(result?.challenge.id, challengeId);
    assert.equal(result?.version.id, draftVersionId);
    assert.deepEqual(result?.stacks.map((stack) => stack.id), [linkedStackId]);
    assert.ok(!result?.stacks.some((stack) => stack.id === unlinkedStackId));
  } finally {
    if (challengeStackId) await db.delete(challengeStacks).where(eq(challengeStacks.id, challengeStackId));
    if (linkedStackId) await db.delete(stacks).where(eq(stacks.id, linkedStackId));
    if (unlinkedStackId) await db.delete(stacks).where(eq(stacks.id, unlinkedStackId));
    if (draftVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, draftVersionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});

test('getDraftVersionForPreview returns undefined for a published version', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId = '';
  let publishedVersionId: string | undefined;
  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Preview published challenge', level: 'junior', contentSlug: 'todo-api' }).returning();
    challengeId = challenge.id;
    const [published] = await db.insert(challengeVersions).values({
      challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
    }).returning();
    publishedVersionId = published.id;

    const result = await getDraftVersionForPreview(challengeId, 1, databaseUrl);

    assert.equal(result, undefined);
  } finally {
    if (publishedVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, publishedVersionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});

test('getDraftVersionForPreview returns undefined for a nonexistent or mismatched version', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let challengeId = '';
  let draftVersionId: string | undefined;
  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Preview mismatch challenge', level: 'junior', contentSlug: 'todo-api' }).returning();
    challengeId = challenge.id;
    const [draft] = await db.insert(challengeVersions).values({
      challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1',
    }).returning();
    draftVersionId = draft.id;

    assert.equal(await getDraftVersionForPreview(challengeId, 2, databaseUrl), undefined);
    assert.equal(await getDraftVersionForPreview('00000000-0000-4000-8000-000000000000', 1, databaseUrl), undefined);
  } finally {
    if (draftVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, draftVersionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});
