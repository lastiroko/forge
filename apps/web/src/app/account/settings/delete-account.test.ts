import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { createSession, SESSION_COOKIE } from '../../../modules/identity/index.js';
import { deleteAccountAction } from './delete-account.js';

const { users, sessions } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const CONFIRM_DELETION_FIELD = 'confirmDeletion';

interface SetCall {
  name: string;
  value: string;
  options: { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge: number };
}

class FakeCookieStore {
  readonly sets: SetCall[] = [];

  constructor(private readonly value: string | undefined) {}

  get(name: string): { value: string } | undefined {
    return name === SESSION_COOKIE && this.value !== undefined ? { value: this.value } : undefined;
  }

  set(name: string, value: string, options: SetCall['options']): void {
    this.sets.push({ name, value, options });
  }
}

let githubIdCounter = 0;

async function insertUser(db: ReturnType<typeof createDbClient>['db']) {
  githubIdCounter += 1;
  const [user] = await db
    .insert(users)
    .values({
      githubId: Date.now() * 1000 + githubIdCounter,
      handle: `delete-account-${randomUUID()}`,
      displayName: 'Delete Account Test User',
      email: `delete-account-${randomUUID()}@example.com`,
      role: 'member',
    })
    .returning();
  return user;
}

function confirmedFormData(): FormData {
  const formData = new FormData();
  formData.set(CONFIRM_DELETION_FIELD, 'on');
  return formData;
}

async function assertRedirectsTo(operation: () => Promise<unknown>, destination: string): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof Error);
    const digest = (error as { digest?: unknown }).digest;
    assert.equal(typeof digest, 'string');
    const [code, type, url] = (digest as string).split(';');
    assert.equal(code, 'NEXT_REDIRECT');
    assert.equal(type, 'replace');
    assert.equal(url, destination);
    return true;
  });
}

test('deleteAccountAction rejects deletion without explicit confirmation and leaves the user and session unchanged', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  let sessionId: string | undefined;
  try {
    const user = await insertUser(db);
    userId = user.id;
    const session = await createSession(user.id, databaseUrl);
    sessionId = session.id;
    const cookieStore = new FakeCookieStore(session.id);

    const result = await deleteAccountAction(new FormData(), cookieStore, databaseUrl);

    assert.deepEqual(result, { ok: false, error: 'confirmation_required' });
    assert.equal(cookieStore.sets.length, 0);

    const [persisted] = await db.select().from(users).where(eq(users.id, user.id));
    assert.deepEqual(persisted, user);
    const remainingSessions = await db.select().from(sessions).where(eq(sessions.id, session.id));
    assert.equal(remainingSessions.length, 1);
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});

test('deleteAccountAction rejects an unauthenticated request without clearing the cookie', async () => {
  const cookieStore = new FakeCookieStore(undefined);

  await assertRedirectsTo(
    () => deleteAccountAction(confirmedFormData(), cookieStore, databaseUrl),
    '/auth/github',
  );

  assert.equal(cookieStore.sets.length, 0);
});

test('deleteAccountAction anonymises the user, deletes every session, clears the session cookie, and redirects home', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  let sessionId: string | undefined;
  try {
    const user = await insertUser(db);
    userId = user.id;
    const session = await createSession(user.id, databaseUrl);
    sessionId = session.id;
    const cookieStore = new FakeCookieStore(session.id);

    await assertRedirectsTo(
      () => deleteAccountAction(confirmedFormData(), cookieStore, databaseUrl),
      '/',
    );

    assert.equal(cookieStore.sets.length, 1);
    const [set] = cookieStore.sets;
    assert.equal(set.name, SESSION_COOKIE);
    assert.equal(set.value, '');
    assert.deepEqual(set.options, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });

    const remainingSessions = await db.select().from(sessions).where(eq(sessions.id, session.id));
    assert.equal(remainingSessions.length, 0);
    sessionId = undefined;

    const [persisted] = await db.select().from(users).where(eq(users.id, user.id));
    assert.equal(persisted.githubId, null);
    assert.equal(persisted.handle, `deleted-${user.id}`);
    assert.equal(persisted.displayName, 'Deleted member');
    assert.equal(persisted.email, `deleted-${user.id}@invalid`);
    assert.equal(persisted.avatarUrl, null);
    assert.equal(persisted.bio, null);
    assert.deepEqual(persisted.links, []);
    assert.equal(persisted.role, 'member');
    assert.ok(persisted.deletedAt instanceof Date);
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});
