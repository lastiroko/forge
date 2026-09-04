import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { createSession, SESSION_COOKIE, type SessionCookieReader } from '../../../modules/identity/index.js';
import {
  COMMENT_RECEIVED_EVENT,
  GRADING_FINISHED_EVENT,
  preferences,
  setEmailPreference,
} from '../../../modules/notifications/index.js';
import { saveNotificationPreferences } from './actions.js';

const { users, sessions, notificationPreferences } = schema;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3424;
const { db, pool } = createDbClient(databaseUrl);

let server: ChildProcess | undefined;
let ownerId: string | undefined;
let otherId: string | undefined;
let ownerSessionId: string | undefined;
let otherSessionId: string | undefined;

function cookieStore(sessionId: string): SessionCookieReader {
  return { get: (name) => name === SESSION_COOKIE ? { value: sessionId } : undefined };
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await fetch(url); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`server at ${url} did not become ready`);
}

function checkbox(html: string, name: string): string {
  const match = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`));
  assert.ok(match, `expected ${name} checkbox`);
  return match[0];
}

before(async () => {
  const createdUsers = await db.insert(users).values([
    {
      githubId: Math.floor(Math.random() * 1_000_000_000),
      handle: `settings-owner-${randomUUID()}`,
      displayName: 'Settings Owner',
      email: `settings-owner-${randomUUID()}@example.com`,
      role: 'member',
    },
    {
      githubId: Math.floor(Math.random() * 1_000_000_000),
      handle: `settings-other-${randomUUID()}`,
      displayName: 'Settings Other',
      email: `settings-other-${randomUUID()}@example.com`,
      role: 'member',
    },
  ]).returning();
  ownerId = createdUsers[0].id;
  otherId = createdUsers[1].id;

  const ownerSession = await createSession(ownerId, databaseUrl);
  const otherSession = await createSession(otherId, databaseUrl);
  ownerSessionId = ownerSession.id;
  otherSessionId = otherSession.id;

  await setEmailPreference(createdUsers[0], GRADING_FINISHED_EVENT, false, databaseUrl);
  await setEmailPreference(createdUsers[1], COMMENT_RECEIVED_EVENT, false, databaseUrl);

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });
  server = spawn('node', ['.next/standalone/apps/web/server.js'], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' },
  });
  await waitForServer(`http://127.0.0.1:${port}/`);
});

after(async () => {
  if (server) server.kill();
  const userIds = [ownerId, otherId].filter((id): id is string => id !== undefined);
  if (userIds.length > 0) {
    await db.delete(notificationPreferences).where(inArray(notificationPreferences.userId, userIds));
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }
  await pool.end();
});

test('GET /account/settings renders persisted and default-enabled preferences', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/account/settings`, {
    headers: { Cookie: `${SESSION_COOKIE}=${ownerSessionId}` },
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Account settings/);
  assert.match(html, /Email me when grading finishes/);
  assert.match(html, /Email me when someone comments on my solution/);
  assert.doesNotMatch(checkbox(html, GRADING_FINISHED_EVENT), /checked/);
  assert.match(checkbox(html, COMMENT_RECEIVED_EVENT), /checked/);
});

test('GET /account/settings rejects unauthenticated access', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/account/settings`);
  assert.notEqual(response.status, 200);
});

test('submitting settings changes only the current member preferences', async () => {
  const formData = new FormData();
  formData.set(GRADING_FINISHED_EVENT, 'on');
  await saveNotificationPreferences(formData, cookieStore(ownerSessionId as string), databaseUrl);

  const ownerRows = await preferences({ id: ownerId as string }, databaseUrl);
  assert.equal(ownerRows.find((row) => row.eventType === GRADING_FINISHED_EVENT)?.emailEnabled, true);
  assert.equal(ownerRows.find((row) => row.eventType === COMMENT_RECEIVED_EVENT)?.emailEnabled, false);

  const otherRows = await preferences({ id: otherId as string }, databaseUrl);
  assert.equal(otherRows.length, 1);
  assert.equal(otherRows[0].eventType, COMMENT_RECEIVED_EVENT);
  assert.equal(otherRows[0].emailEnabled, false);
});

test('submitting settings without checkbox values persists both as disabled', async () => {
  await saveNotificationPreferences(new FormData(), cookieStore(otherSessionId as string), databaseUrl);
  const rows = await preferences({ id: otherId as string }, databaseUrl);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.emailEnabled === false));
});
