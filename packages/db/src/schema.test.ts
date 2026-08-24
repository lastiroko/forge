import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { enrollments, users, sessions } from './schema.js';

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

test('inserts a user and a session referencing it and reads both back', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  let insertedUser;
  let insertedSession;
  try {
    [insertedUser] = await db
      .insert(users)
      .values({
        githubId: 12345,
        handle: 'octocat',
        displayName: 'Octo Cat',
        avatarUrl: 'https://example.com/avatar.png',
        email: 'octocat@example.com',
        role: 'member',
      })
      .returning();

    [insertedSession] = await db
      .insert(sessions)
      .values({ userId: insertedUser.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) })
      .returning();

    const [userRow] = await db.select().from(users).where(eq(users.id, insertedUser.id));
    const [sessionRow] = await db.select().from(sessions).where(eq(sessions.id, insertedSession.id));

    assert.equal(userRow.githubId, 12345);
    assert.equal(userRow.handle, 'octocat');
    assert.equal(userRow.role, 'member');
    assert.equal(sessionRow.id, insertedSession.id);
    assert.equal(sessionRow.userId, insertedUser.id);
  } finally {
    if (insertedSession) {
      await db.delete(sessions).where(eq(sessions.id, insertedSession.id));
    }
    if (insertedUser) {
      await db.delete(users).where(eq(users.id, insertedUser.id));
    }
    await pool.end();
  }
});
