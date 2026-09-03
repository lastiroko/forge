import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { createSession, deleteSession, getCurrentUser, SESSION_COOKIE } from '../../modules/identity/index.js';
import { createSignOutHandler, type SignOutCookieStore } from './sign-out.js';

const { users, sessions } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

interface SetCall {
  name: string;
  value: string;
  options: { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge: number };
}

class FakeCookieStore implements SignOutCookieStore {
  readonly sets: SetCall[] = [];

  constructor(private readonly value: string | undefined) {}

  get(name: string): { value: string } | undefined {
    return name === SESSION_COOKIE && this.value !== undefined ? { value: this.value } : undefined;
  }

  set(name: string, value: string, options: SetCall['options']): void {
    this.sets.push({ name, value, options });
  }
}

function assertCookieCleared(cookieStore: FakeCookieStore): void {
  assert.equal(cookieStore.sets.length, 1);
  const [set] = cookieStore.sets;
  assert.equal(set.name, SESSION_COOKIE);
  assert.equal(set.value, '');
  assert.deepEqual(set.options, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

test('sign-out passes the current session id to deletion and clears the cookie', async () => {
  const cookieStore = new FakeCookieStore('a-session-id');
  let deletedSessionId: string | undefined;
  const signOut = createSignOutHandler({
    cookieStore,
    deleteSession: async (sessionId) => { deletedSessionId = sessionId; },
  });

  await signOut();

  assert.equal(deletedSessionId, 'a-session-id');
  assertCookieCleared(cookieStore);
});

test('sign-out skips deletion when the session cookie is absent but still clears the cookie', async () => {
  const cookieStore = new FakeCookieStore(undefined);
  let deleteCalls = 0;
  const signOut = createSignOutHandler({
    cookieStore,
    deleteSession: async () => { deleteCalls += 1; },
  });

  await signOut();

  assert.equal(deleteCalls, 0);
  assertCookieCleared(cookieStore);
});

test('sign-out deletes the database session and the original cookie no longer resolves a user', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  let sessionId: string | undefined;
  try {
    const [user] = await db
      .insert(users)
      .values({
        githubId: Date.now(),
        handle: `sign-out-${randomUUID()}`,
        displayName: 'Sign Out Test User',
        email: `sign-out-${randomUUID()}@example.com`,
        role: 'member',
      })
      .returning();
    userId = user.id;
    const session = await createSession(user.id, databaseUrl);
    sessionId = session.id;

    const cookieStore = new FakeCookieStore(session.id);
    const signOut = createSignOutHandler({
      cookieStore,
      deleteSession: (id) => deleteSession(id, databaseUrl),
    });

    await signOut();

    const remaining = await db.select().from(sessions).where(eq(sessions.id, session.id));
    assert.equal(remaining.length, 0);
    assertCookieCleared(cookieStore);

    const resolved = await getCurrentUser({ get: () => ({ value: session.id }) }, databaseUrl);
    assert.equal(resolved, undefined);
    sessionId = undefined;
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});
