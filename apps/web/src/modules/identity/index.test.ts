import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import {
  createSession,
  deleteSession,
  getCurrentUser,
  requireRole,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type SessionCookieReader,
} from './index.js';

const { users, sessions } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const testDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDir, '..', '..', '..');
const probeScriptPath = path.join(testDir, 'session-process-probe.ts');

function cookieStoreFor(sessionId: string | undefined): SessionCookieReader {
  return {
    get: (name: string) => (sessionId !== undefined && name === SESSION_COOKIE ? { value: sessionId } : undefined),
  };
}

let githubIdCounter = 0;

async function insertUser(db: ReturnType<typeof createDbClient>['db']) {
  githubIdCounter += 1;
  const [user] = await db
    .insert(users)
    .values({
      githubId: Date.now() * 1000 + githubIdCounter,
      handle: `identity-${randomUUID()}`,
      displayName: 'Identity Test User',
      email: `identity-${randomUUID()}@example.com`,
      role: 'member',
    })
    .returning();
  return user;
}

test('createSession inserts a row that expires SESSION_TTL_SECONDS after creation', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  let sessionId: string | undefined;
  try {
    const user = await insertUser(db);
    userId = user.id;

    const before = Date.now();
    const session = await createSession(user.id, databaseUrl);
    sessionId = session.id;
    const after = Date.now();

    assert.equal(session.userId, user.id);
    const expiresAt = session.expiresAt.getTime();
    assert.ok(expiresAt >= before + SESSION_TTL_SECONDS * 1000);
    assert.ok(expiresAt <= after + SESSION_TTL_SECONDS * 1000);
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});

test('getCurrentUser resolves the user referenced by a valid session cookie', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  let sessionId: string | undefined;
  try {
    const user = await insertUser(db);
    userId = user.id;
    const session = await createSession(user.id, databaseUrl);
    sessionId = session.id;

    const resolved = await getCurrentUser(cookieStoreFor(session.id), databaseUrl);

    assert.deepEqual(resolved, user);
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});

test('getCurrentUser returns undefined when the session cookie is missing', async () => {
  const resolved = await getCurrentUser(cookieStoreFor(undefined), databaseUrl);
  assert.equal(resolved, undefined);
});

test('getCurrentUser returns undefined for an unknown session id', async () => {
  const resolved = await getCurrentUser(cookieStoreFor(randomUUID()), databaseUrl);
  assert.equal(resolved, undefined);
});

test('getCurrentUser returns undefined for an expired session', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  let sessionId: string | undefined;
  try {
    const user = await insertUser(db);
    userId = user.id;
    const [session] = await db
      .insert(sessions)
      .values({ userId: user.id, expiresAt: new Date(Date.now() - 1000) })
      .returning();
    sessionId = session.id;

    const resolved = await getCurrentUser(cookieStoreFor(session.id), databaseUrl);

    assert.equal(resolved, undefined);
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});

test('getCurrentUser resolves the same session through two independent database clients', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  let sessionId: string | undefined;
  try {
    const user = await insertUser(db);
    userId = user.id;
    const session = await createSession(user.id, databaseUrl);
    sessionId = session.id;

    // getCurrentUser opens and closes its own database client on every call, so calling it
    // twice in a row exercises two independent clients resolving the same session, the same
    // way two separate web processes sharing only the database would.
    const resolvedFirst = await getCurrentUser(cookieStoreFor(session.id), databaseUrl);
    const resolvedSecond = await getCurrentUser(cookieStoreFor(session.id), databaseUrl);
    assert.deepEqual(resolvedFirst, user);
    assert.deepEqual(resolvedSecond, user);
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});

test('a session created by this process resolves in a genuinely separate Node process', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  let sessionId: string | undefined;
  try {
    const user = await insertUser(db);
    userId = user.id;
    const session = await createSession(user.id, databaseUrl);
    sessionId = session.id;

    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', probeScriptPath, session.id],
      { cwd: webRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf-8' },
    );

    assert.deepEqual(JSON.parse(output), { userId: user.id });
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});

test('deleteSession removes the row and invalidates the original cookie', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  let userId: string | undefined;
  let sessionId: string | undefined;
  try {
    const user = await insertUser(db);
    userId = user.id;
    const session = await createSession(user.id, databaseUrl);
    sessionId = session.id;

    await deleteSession(session.id, databaseUrl);

    const remaining = await db.select().from(sessions).where(eq(sessions.id, session.id));
    assert.equal(remaining.length, 0);
    assert.equal(await getCurrentUser(cookieStoreFor(session.id), databaseUrl), undefined);
    sessionId = undefined;
  } finally {
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});

test('requireRole rejects because the identity module is a skeleton', async () => {
  await assert.rejects(() => requireRole('member'), /not implemented/);
});
