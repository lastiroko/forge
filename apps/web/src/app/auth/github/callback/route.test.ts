import { after, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  upsertGithubUser,
  type GitHubIdentity,
  type Session,
  type User,
} from '../../../../modules/identity/index.js';
import { createGithubCallbackHandler } from './handler.js';

const { users, sessions } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const { db, pool } = createDbClient(databaseUrl);
const githubId = 16_000_016;

after(async () => {
  const matchingUsers = await db.select({ id: users.id }).from(users).where(eq(users.githubId, githubId));
  for (const user of matchingUsers) await db.delete(sessions).where(eq(sessions.userId, user.id));
  await db.delete(users).where(eq(users.githubId, githubId));
  await pool.end();
});

function request(state = 'valid-state', code = 'oauth-code'): Request {
  return new Request(`https://forge.example/auth/github/callback?code=${code}&state=${state}`, {
    headers: { Cookie: 'github_oauth_state=valid-state' },
  });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function fakeSession(userId: string): Session {
  return { id: 'fake-session-id', userId, expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000), createdAt: new Date() };
}

test('callback exchanges GitHub data, upserts one user, and persists a session on each successful callback', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let round = 0;
  const mockFetch: typeof fetch = async (input, init) => {
    const url = input.toString();
    calls.push({ url, init });
    if (url.endsWith('/access_token')) return json({ access_token: `secret-token-${round}` });
    if (url.endsWith('/user')) {
      round += 1;
      return json({
        id: githubId,
        login: round === 1 ? 'octo-first' : 'octo-second',
        name: round === 1 ? 'Octo First' : 'Octo Second',
        avatar_url: `https://avatars.example/${round}`,
        company: 'must not be persisted',
        bio: 'must not be persisted',
        followers: 999,
      });
    }
    return json([
      { email: `secondary-${round}@example.com`, primary: false, verified: true },
      { email: `primary-${round}@example.com`, primary: true, verified: true, visibility: 'private' },
    ]);
  };
  const handler = createGithubCallbackHandler({
    clientId: 'client-id', clientSecret: 'client-secret', fetch: mockFetch,
    upsertUser: (identity) => upsertGithubUser(identity, databaseUrl),
    createSession: (userId) => createSession(userId, databaseUrl),
  });

  const beforeFirstCall = Date.now();
  const firstResponse = await handler(request());
  assert.equal(firstResponse.status, 302);
  assert.equal(firstResponse.headers.get('location'), 'https://forge.example/');

  const firstCookies = firstResponse.headers.getSetCookie();
  assert.equal(firstCookies.length, 2);
  assert.match(firstCookies[0], /^github_oauth_state=;/);
  assert.match(firstCookies[0], /Max-Age=0/);

  let rows = await db.select().from(users).where(eq(users.githubId, githubId));
  assert.equal(rows.length, 1);
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, rows[0].id));

  let sessionRows = await db.select().from(sessions).where(eq(sessions.userId, rows[0].id));
  assert.equal(sessionRows.length, 1);
  assert.ok(sessionRows[0].expiresAt.getTime() >= beforeFirstCall + SESSION_TTL_SECONDS * 1000);
  assert.ok(sessionRows[0].expiresAt.getTime() <= Date.now() + SESSION_TTL_SECONDS * 1000);

  const sessionCookie = firstCookies[1];
  assert.match(sessionCookie, new RegExp(`^${SESSION_COOKIE}=${sessionRows[0].id};`));
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /Secure/);
  assert.match(sessionCookie, /SameSite=Lax/);
  assert.match(sessionCookie, /Path=\//);
  assert.match(sessionCookie, new RegExp(`Max-Age=${SESSION_TTL_SECONDS}`));

  const secondResponse = await handler(request());
  assert.equal(secondResponse.status, 302);
  rows = await db.select().from(users).where(eq(users.githubId, githubId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].handle, 'octo-second');
  // displayName is set on insert only, so a member's edited name survives later GitHub sign-ins.
  assert.equal(rows[0].displayName, 'Octo First');
  assert.equal(rows[0].avatarUrl, 'https://avatars.example/2');
  assert.equal(rows[0].email, 'primary-2@example.com');
  assert.equal(rows[0].role, 'admin');

  sessionRows = await db.select().from(sessions).where(eq(sessions.userId, rows[0].id));
  assert.equal(sessionRows.length, 2);

  const secondCookies = secondResponse.headers.getSetCookie();
  assert.equal(secondCookies.length, 2);
  assert.match(secondCookies[1], new RegExp(`^${SESSION_COOKIE}=`));

  const tokenCall = calls[0];
  assert.equal(tokenCall.url, 'https://github.com/login/oauth/access_token');
  assert.equal(tokenCall.init?.method, 'POST');
  assert.equal(new Headers(tokenCall.init?.headers).get('accept'), 'application/json');
  const body = new URLSearchParams(tokenCall.init?.body as string);
  assert.equal(body.get('client_id'), 'client-id');
  assert.equal(body.get('client_secret'), 'client-secret');
  assert.equal(body.get('code'), 'oauth-code');
  for (const call of calls.filter((item) => item.url.startsWith('https://api.github.com/'))) {
    const headers = new Headers(call.init?.headers);
    assert.match(headers.get('authorization')!, /^Bearer secret-token-/);
    assert.equal(headers.get('accept'), 'application/vnd.github+json');
  }
});

test('callback rejects missing code and invalid state without contacting GitHub or creating a session', async () => {
  let calls = 0;
  let sessionCalls = 0;
  const handler = createGithubCallbackHandler({
    clientId: 'id', clientSecret: 'secret', fetch: async () => { calls += 1; return json({}); },
    upsertUser: async () => { throw new Error('unexpected'); },
    createSession: async (userId) => { sessionCalls += 1; return fakeSession(userId); },
  });
  assert.equal((await handler(new Request('https://forge.example/auth/github/callback?state=valid-state'))).status, 400);
  assert.equal((await handler(request('wrong-state'))).status, 400);
  assert.equal(calls, 0);
  assert.equal(sessionCalls, 0);
});

test('callback requires a verified primary email and does not create a session', async () => {
  const responses = [
    json({ access_token: 'token' }),
    json({ id: 1, login: 'octo', name: null, avatar_url: null }),
    json([{ email: 'unverified@example.com', primary: true, verified: false }]),
  ];
  let sessionCalls = 0;
  const handler = createGithubCallbackHandler({
    clientId: 'id', clientSecret: 'secret', fetch: async () => responses.shift()!,
    upsertUser: async () => { throw new Error('unexpected'); },
    createSession: async (userId) => { sessionCalls += 1; return fakeSession(userId); },
  });
  assert.equal((await handler(request())).status, 400);
  assert.equal(sessionCalls, 0);
});

test('callback maps only approved GitHub fields to the identity dependency', async () => {
  const responses = [
    json({ access_token: 'token', scope: 'extra' }),
    json({ id: 42, login: 'octo', name: null, avatar_url: null, bio: 'excluded', company: 'excluded' }),
    json([{ email: 'octo@example.com', primary: true, verified: true, visibility: 'private' }]),
  ];
  let received: GitHubIdentity | undefined;
  const handler = createGithubCallbackHandler({
    clientId: 'id', clientSecret: 'secret', fetch: async () => responses.shift()!,
    upsertUser: async (identity) => {
      received = identity;
      return { ...identity, id: 'user-id', role: 'member', bio: null, links: [], deletedAt: null, createdAt: new Date() } satisfies User;
    },
    createSession: async (userId) => fakeSession(userId),
  });
  assert.equal((await handler(request())).status, 302);
  assert.deepEqual(received, {
    githubId: 42, handle: 'octo', displayName: 'octo', avatarUrl: null, email: 'octo@example.com',
  });
});

test('callback returns 502 for token, API, and malformed provider responses without creating a session', async () => {
  const scenarios: Response[][] = [
    [json({}, 500)],
    [json({ nope: 'token' })],
    [json({ access_token: 'token' }), json({}, 500), json([])],
    [json({ access_token: 'token' }), json({ id: 'invalid' }), json([])],
  ];
  for (const responses of scenarios) {
    let sessionCalls = 0;
    const handler = createGithubCallbackHandler({
      clientId: 'id', clientSecret: 'secret', fetch: async () => responses.shift()!,
      upsertUser: async () => { throw new Error('unexpected'); },
      createSession: async (userId) => { sessionCalls += 1; return fakeSession(userId); },
    });
    assert.equal((await handler(request())).status, 502);
    assert.equal(sessionCalls, 0);
  }
});
