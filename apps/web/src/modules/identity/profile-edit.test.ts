import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import {
  AuthorizationError,
  getPublicProfile,
  updateCurrentUserProfile,
  SESSION_COOKIE,
  type SessionCookieReader,
} from './index.js';

const { users, sessions } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

function cookieStoreFor(sessionId: string | undefined): SessionCookieReader {
  return {
    get: (name: string) => (sessionId !== undefined && name === SESSION_COOKIE ? { value: sessionId } : undefined),
  };
}

async function seedMember(db: ReturnType<typeof createDbClient>['db'], handle: string) {
  const unique = randomUUID();
  const [user] = await db
    .insert(users)
    .values({
      githubId: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      handle: `${handle}-${unique}`,
      displayName: 'Profile Edit User',
      email: `${handle}-${unique}@example.com`,
      role: 'member',
    })
    .returning();
  return user;
}

test('a valid edit persists and appears through getPublicProfile', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  let sessionId: string | undefined;
  try {
    const user = await seedMember(db, 'profile-edit-valid');
    userId = user.id;
    const [session] = await db.insert(sessions).values({ userId: user.id, expiresAt: new Date(Date.now() + 60_000) }).returning();
    sessionId = session.id;

    const result = await updateCurrentUserProfile(
      { displayName: 'Updated Name', bio: 'New bio here.', links: ['https://example.com', 'https://github.com/updated'] },
      cookieStoreFor(session.id),
      databaseUrl,
    );

    assert.equal(result.ok, true);
    assert.equal((result as { ok: true; user: typeof user }).user.displayName, 'Updated Name');

    const profile = await getPublicProfile(user.handle, databaseUrl);
    assert.equal(profile?.displayName, 'Updated Name');
    assert.equal(profile?.bio, 'New bio here.');
    assert.deepEqual(profile?.links, ['https://example.com', 'https://github.com/updated']);
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});

test('an unauthenticated edit is rejected without mutation', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  try {
    const user = await seedMember(db, 'profile-edit-unauth');
    userId = user.id;

    await assert.rejects(
      () => updateCurrentUserProfile({ displayName: 'Should Not Save', bio: '', links: [] }, cookieStoreFor(undefined), databaseUrl),
      (error: unknown) => error instanceof AuthorizationError,
    );

    const [row] = await db.select().from(users).where(eq(users.id, userId));
    assert.equal(row.displayName, 'Profile Edit User');
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});

test('one member cannot edit another member', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let actingUserId: string | undefined;
  let otherUserId: string | undefined;
  let sessionId: string | undefined;
  try {
    const actingUser = await seedMember(db, 'profile-edit-acting');
    actingUserId = actingUser.id;
    const otherUser = await seedMember(db, 'profile-edit-other');
    otherUserId = otherUser.id;
    const [session] = await db.insert(sessions).values({ userId: actingUser.id, expiresAt: new Date(Date.now() + 60_000) }).returning();
    sessionId = session.id;

    const result = await updateCurrentUserProfile(
      { displayName: 'Acting User Renamed', bio: '', links: [] },
      cookieStoreFor(session.id),
      databaseUrl,
    );

    assert.equal(result.ok, true);
    const [actingRow] = await db.select().from(users).where(eq(users.id, actingUserId));
    const [otherRow] = await db.select().from(users).where(eq(users.id, otherUserId));
    assert.equal(actingRow.displayName, 'Acting User Renamed');
    assert.equal(otherRow.displayName, 'Profile Edit User');
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (actingUserId) await db.delete(users).where(eq(users.id, actingUserId));
    if (otherUserId) await db.delete(users).where(eq(users.id, otherUserId));
    await pool.end();
  }
});

test('invalid display names, oversized bios, malformed URLs, and too many links are rejected without mutation', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  let sessionId: string | undefined;
  try {
    const user = await seedMember(db, 'profile-edit-invalid');
    userId = user.id;
    const [session] = await db.insert(sessions).values({ userId: user.id, expiresAt: new Date(Date.now() + 60_000) }).returning();
    sessionId = session.id;
    const cookieStore = cookieStoreFor(session.id);

    const cases: Array<{ input: { displayName: string; bio: string; links: string[] }; field: 'displayName' | 'bio' | 'links' }> = [
      { input: { displayName: '', bio: '', links: [] }, field: 'displayName' },
      { input: { displayName: 'x'.repeat(101), bio: '', links: [] }, field: 'displayName' },
      { input: { displayName: 'Valid Name', bio: 'x'.repeat(281), links: [] }, field: 'bio' },
      { input: { displayName: 'Valid Name', bio: '', links: ['not-a-url'] }, field: 'links' },
      { input: { displayName: 'Valid Name', bio: '', links: ['ftp://example.com'] }, field: 'links' },
      { input: { displayName: 'Valid Name', bio: '', links: Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`) }, field: 'links' },
    ];

    for (const { input, field } of cases) {
      const result = await updateCurrentUserProfile(input, cookieStore, databaseUrl);
      assert.equal(result.ok, false);
      assert.ok((result as { ok: false; errors: Record<string, string> }).errors[field]);
    }

    const [row] = await db.select().from(users).where(eq(users.id, userId));
    assert.equal(row.displayName, 'Profile Edit User');
    assert.equal(row.bio, null);
    assert.deepEqual(row.links, []);
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});
