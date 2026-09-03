import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import {
  AuthorizationError,
  changeUserRole,
  createSession,
  requireRole,
  SESSION_COOKIE,
  type Role,
  type SessionCookieReader,
  type User,
} from './index.js';

const { users, sessions } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

function cookieStoreFor(sessionId: string | undefined): SessionCookieReader {
  return {
    get: (name: string) => (sessionId !== undefined && name === SESSION_COOKIE ? { value: sessionId } : undefined),
  };
}

async function adminRoute(cookieStore: SessionCookieReader): Promise<Response> {
  try {
    const user = await requireRole('admin', cookieStore, databaseUrl);
    return Response.json({ userId: user.id });
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response(null, { status: error.status });
    throw error;
  }
}

async function rejectsWithForbidden(operation: () => Promise<unknown>): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof AuthorizationError);
    assert.equal(error.status, 403);
    return true;
  });
}

test('role authorization and role changes enforce the role hierarchy', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userIds: string[] = [];
  const sessionIds: string[] = [];

  async function seedUser(role: Role): Promise<{ user: User; cookieStore: SessionCookieReader }> {
    const unique = randomUUID();
    const [user] = await db
      .insert(users)
      .values({
        githubId: Date.now() * 1000 + userIds.length,
        handle: `authorization-${unique}`,
        displayName: `${role} Authorization User`,
        email: `authorization-${unique}@example.com`,
        role,
      })
      .returning();
    userIds.push(user.id);

    const session = await createSession(user.id, databaseUrl);
    sessionIds.push(session.id);
    return { user, cookieStore: cookieStoreFor(session.id) };
  }

  try {
    const member = await seedUser('member');
    const author = await seedUser('author');
    const admin = await seedUser('admin');
    const target = await seedUser('member');

    const memberResponse = await adminRoute(member.cookieStore);
    assert.equal(memberResponse.status, 403);

    assert.equal((await requireRole('member', member.cookieStore, databaseUrl)).id, member.user.id);
    await rejectsWithForbidden(() => requireRole('author', member.cookieStore, databaseUrl));

    const adminResponse = await adminRoute(admin.cookieStore);
    assert.equal(adminResponse.status, 200);
    assert.deepEqual(await adminResponse.json(), { userId: admin.user.id });

    assert.equal((await requireRole('member', author.cookieStore, databaseUrl)).id, author.user.id);
    assert.equal((await requireRole('author', author.cookieStore, databaseUrl)).id, author.user.id);
    await rejectsWithForbidden(() => requireRole('admin', author.cookieStore, databaseUrl));

    await db.update(users).set({ role: 'unsupported' }).where(eq(users.id, author.user.id));
    await rejectsWithForbidden(() => requireRole('member', author.cookieStore, databaseUrl));
    await db.update(users).set({ role: 'author' }).where(eq(users.id, author.user.id));

    for (const role of ['member', 'author', 'admin'] as const) {
      assert.equal((await requireRole(role, admin.cookieStore, databaseUrl)).id, admin.user.id);
    }

    await rejectsWithForbidden(() => requireRole('member', cookieStoreFor(undefined), databaseUrl));

    for (const actor of [member, author]) {
      await rejectsWithForbidden(() => changeUserRole(target.user.id, 'admin', actor.cookieStore, databaseUrl));
      const [unchanged] = await db.select().from(users).where(eq(users.id, target.user.id));
      assert.equal(unchanged.role, 'member');
    }

    for (const role of ['author', 'admin', 'member'] as const) {
      const updated = await changeUserRole(target.user.id, role, admin.cookieStore, databaseUrl);
      assert.equal(updated?.role, role);
      const [persisted] = await db.select().from(users).where(eq(users.id, target.user.id));
      assert.equal(persisted.role, role);
    }

    await rejectsWithForbidden(() => changeUserRole(admin.user.id, 'member', admin.cookieStore, databaseUrl));
    const [unchangedAdmin] = await db.select().from(users).where(eq(users.id, admin.user.id));
    assert.equal(unchangedAdmin.role, 'admin');

    assert.equal(
      await changeUserRole(randomUUID(), 'author', admin.cookieStore, databaseUrl),
      undefined,
    );
  } finally {
    if (sessionIds.length > 0) await db.delete(sessions).where(inArray(sessions.id, sessionIds));
    if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  }
});
