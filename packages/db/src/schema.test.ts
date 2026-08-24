import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { enrollments } from './schema.js';

test('inserts an enrollment linking a user, version and stack and reads it back', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const challengeVersionId = randomUUID();
  const stackId = randomUUID();
  let insertedId;
  try {
    const [inserted] = await db
      .insert(enrollments)
      .values({ userId, challengeVersionId, mode: 'backend', stackId, status: 'pending' })
      .returning();
    insertedId = inserted.id;

    const [row] = await db.select().from(enrollments).where(eq(enrollments.id, insertedId));

    assert.equal(row.userId, userId);
    assert.equal(row.challengeVersionId, challengeVersionId);
    assert.equal(row.stackId, stackId);
    assert.equal(row.mode, 'backend');
    assert.equal(row.status, 'pending');
  } finally {
    if (insertedId) {
      await db.delete(enrollments).where(eq(enrollments.id, insertedId));
    }
    await pool.end();
  }
});
