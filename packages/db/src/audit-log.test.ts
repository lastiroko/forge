import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient } from './client.js';
import { users, auditLog } from './schema.js';

test('inserts an audit log row referencing an admin user and reads it back', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  const targetId = randomUUID();
  let insertedUser;
  let insertedAuditLog;
  try {
    [insertedUser] = await db
      .insert(users)
      .values({
        githubId: 58001,
        handle: 'audit-admin',
        displayName: 'Audit Admin',
        email: 'audit-admin@example.com',
        role: 'admin',
      })
      .returning();

    [insertedAuditLog] = await db
      .insert(auditLog)
      .values({
        actorId: insertedUser.id,
        action: 'challenge.disable',
        targetType: 'challenge',
        targetId,
        reason: 'Reported for plagiarism',
      })
      .returning();

    const [auditLogRow] = await db.select().from(auditLog).where(eq(auditLog.id, insertedAuditLog.id));

    assert.equal(auditLogRow.actorId, insertedUser.id);
    assert.equal(auditLogRow.action, 'challenge.disable');
    assert.equal(auditLogRow.targetType, 'challenge');
    assert.equal(auditLogRow.targetId, targetId);
    assert.equal(auditLogRow.reason, 'Reported for plagiarism');
    assert.ok(auditLogRow.createdAt instanceof Date);
  } finally {
    if (insertedAuditLog) {
      await db.delete(auditLog).where(eq(auditLog.id, insertedAuditLog.id));
    }
    if (insertedUser) {
      await db.delete(users).where(eq(users.id, insertedUser.id));
    }
    await pool.end();
  }
});
