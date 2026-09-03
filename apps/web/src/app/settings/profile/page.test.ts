import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { SESSION_COOKIE } from '../../../modules/identity/index.js';

const { users, sessions } = schema;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3424;
const origin = `http://127.0.0.1:${port}`;
const { db, pool } = createDbClient(databaseUrl);
const ids: Record<string, string[]> = { users: [], sessions: [] };
let sessionId: string;
let server: ChildProcess | undefined;

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await fetch(url); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`server at ${url} did not become ready`);
}

function sessionHeaders(id: string): { cookie: string } {
  return { cookie: `${SESSION_COOKIE}=${id}` };
}

function extractHiddenFields(html: string): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  for (const inputTag of html.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []) {
    const name = inputTag.match(/name="([^"]*)"/)?.[1];
    const value = inputTag.match(/value="([^"]*)"/)?.[1] ?? '';
    if (name) fields.push([name, value]);
  }
  return fields;
}

before(async () => {
  const [user] = await db.insert(users).values({
    githubId: 56900, handle: 'settings-member', displayName: 'Settings Member', email: 'settings@example.com', role: 'member',
  }).returning();
  ids.users.push(user.id);
  const [session] = await db.insert(sessions).values({ userId: user.id, expiresAt: new Date(Date.now() + 60_000) }).returning();
  sessionId = session.id;
  ids.sessions.push(session.id);

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });
  server = spawn('node', ['.next/standalone/apps/web/server.js'], {
    cwd: webRoot, env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' },
  });
  await waitForServer(`${origin}/settings/profile`);
});

after(async () => {
  if (server) server.kill();
  if (ids.sessions.length) await db.delete(sessions).where(inArray(sessions.id, ids.sessions));
  if (ids.users.length) await db.delete(users).where(inArray(users.id, ids.users));
  await pool.end();
});

test('GET /settings/profile redirects an unauthenticated visitor to GitHub sign-in', async () => {
  const response = await fetch(`${origin}/settings/profile`, { redirect: 'manual' });
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), '/auth/github');
});

test('GET /settings/profile shows the current display name, bio, and links for a signed-in member', async () => {
  const response = await fetch(`${origin}/settings/profile`, { headers: sessionHeaders(sessionId) });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.ok(body.includes('Settings Member'));
});

test('submitting the settings form saves the profile and the public profile reflects it after the redirect', async () => {
  const getResponse = await fetch(`${origin}/settings/profile`, { headers: sessionHeaders(sessionId) });
  const hiddenFields = extractHiddenFields(await getResponse.text());

  const formData = new FormData();
  for (const [name, value] of hiddenFields) formData.set(name, value);
  formData.set('displayName', 'Settings Member Renamed');
  formData.set('bio', 'Updated bio from settings.');
  formData.set('links', 'https://example.com\nhttps://github.com/settings-member');

  const response = await fetch(`${origin}/settings/profile`, {
    method: 'POST',
    headers: { ...sessionHeaders(sessionId), origin },
    body: formData,
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.ok(response.url.endsWith('/u/settings-member'));
  assert.ok(body.includes('Settings Member Renamed'));
  assert.ok(body.includes('Updated bio from settings.'));
  assert.ok(body.includes('href="https://example.com"'));
  assert.ok(body.includes('href="https://github.com/settings-member"'));
});
