import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { createSession, SESSION_COOKIE } from '../../../../../../../modules/identity/index.js';

const { users, sessions, challenges, challengeVersions, challengeStacks, stacks, enrollments } = schema;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3425;
const { db, pool } = createDbClient(databaseUrl);
const ids: Record<string, string[]> = { users: [], sessions: [], challenges: [], versions: [], stacks: [], challengeStacks: [] };

let challengeId: string;
let draftVersionId: string;
let publishedVersionId: string;
let authorSessionId: string;
let adminSessionId: string;
let memberSessionId: string;
let server: ChildProcess | undefined;

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await fetch(url); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`server at ${url} did not become ready`);
}

function sessionHeaders(sessionId?: string): Record<string, string> {
  return sessionId ? { cookie: `${SESSION_COOKIE}=${sessionId}` } : {};
}

before(async () => {
  const createdUsers = await db.insert(users).values([
    { githubId: Math.floor(Math.random() * 1_000_000_000), handle: `preview-page-author-${randomUUID()}`, displayName: 'Preview Page Author', email: `preview-page-author-${randomUUID()}@example.com`, role: 'author' },
    { githubId: Math.floor(Math.random() * 1_000_000_000), handle: `preview-page-admin-${randomUUID()}`, displayName: 'Preview Page Admin', email: `preview-page-admin-${randomUUID()}@example.com`, role: 'admin' },
    { githubId: Math.floor(Math.random() * 1_000_000_000), handle: `preview-page-member-${randomUUID()}`, displayName: 'Preview Page Member', email: `preview-page-member-${randomUUID()}@example.com`, role: 'member' },
  ]).returning();
  ids.users.push(...createdUsers.map(({ id }) => id));
  const [authorSession, adminSession, memberSession] = await Promise.all(
    createdUsers.map((user) => createSession(user.id, databaseUrl)),
  );
  ids.sessions.push(authorSession.id, adminSession.id, memberSession.id);
  authorSessionId = authorSession.id;
  adminSessionId = adminSession.id;
  memberSessionId = memberSession.id;

  const [challenge] = await db.insert(challenges).values({ title: 'Todo Items API', level: 'junior', contentSlug: 'todo-api' }).returning();
  challengeId = challenge.id;
  ids.challenges.push(challenge.id);

  const [draftVersion] = await db.insert(challengeVersions).values({
    challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1',
  }).returning();
  draftVersionId = draftVersion.id;
  ids.versions.push(draftVersion.id);

  const [publishedVersion] = await db.insert(challengeVersions).values({
    challengeId, version: 2, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
  }).returning();
  publishedVersionId = publishedVersion.id;
  ids.versions.push(publishedVersion.id);

  const [stack] = await db.insert(stacks).values({ language: 'Python', framework: 'FastAPI', templateKey: 'python-fastapi' }).returning();
  ids.stacks.push(stack.id);
  const [link] = await db.insert(challengeStacks).values({ challengeId, stackId: stack.id }).returning();
  ids.challengeStacks.push(link.id);

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });
  server = spawn('node', ['.next/standalone/apps/web/server.js'], {
    cwd: webRoot, env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' },
  });
  await waitForServer(`http://127.0.0.1:${port}/author/challenges/${challengeId}/versions/${draftVersionId}/preview`);
});

after(async () => {
  if (server) server.kill();
  if (ids.challengeStacks.length) await db.delete(challengeStacks).where(inArray(challengeStacks.id, ids.challengeStacks));
  if (ids.stacks.length) await db.delete(stacks).where(inArray(stacks.id, ids.stacks));
  if (ids.versions.length) await db.delete(challengeVersions).where(inArray(challengeVersions.id, ids.versions));
  if (ids.challenges.length) await db.delete(challenges).where(inArray(challenges.id, ids.challenges));
  if (ids.sessions.length) await db.delete(sessions).where(inArray(sessions.id, ids.sessions));
  if (ids.users.length) await db.delete(users).where(inArray(users.id, ids.users));
  await pool.end();
});

test('GET .../preview shows the Python FastAPI file list for an author and admin, with no edit/publish/enrollment controls', async () => {
  for (const sessionId of [authorSessionId, adminSessionId]) {
    const response = await fetch(`http://127.0.0.1:${port}/author/challenges/${challengeId}/versions/1/preview`, {
      headers: sessionHeaders(sessionId),
    });
    const body = await response.text();
    const mainMatch = body.match(/<main[^>]*>([\s\S]*)<\/main>/);
    assert.ok(mainMatch, 'expected response body to contain a <main> section');
    const main = mainMatch![1];

    assert.equal(response.status, 200);
    assert.match(body, /Todo Items API/);
    assert.match(body, /Python \/ FastAPI — backend/);
    for (const file of [
      'README.md',
      'openapi.yaml',
      'challenge.yml',
      'Dockerfile',
      'docker-compose.yml',
      'app/routes/getHealth.py',
      'app/routes/getItems.py',
      'app/routes/postItems.py',
      'app/routes/getItemsById.py',
      'app/routes/patchItemsById.py',
      'app/routes/deleteItemsById.py',
      'checks/functional-public.json',
      '.github/workflows/checks.yml',
    ]) {
      assert.ok(body.includes(file), `expected body to include ${file}`);
    }
    assert.doesNotMatch(main, /<form/);
    assert.doesNotMatch(main, /<button/);
    assert.doesNotMatch(main, /Publish/);
    assert.doesNotMatch(main, /Start challenge/);
  }
});

test('GET .../preview returns 404 for anonymous, member, invalid version, unknown version, and published version', async () => {
  const requests: Array<[string, Record<string, string>]> = [
    [`http://127.0.0.1:${port}/author/challenges/${challengeId}/versions/1/preview`, sessionHeaders(undefined)],
    [`http://127.0.0.1:${port}/author/challenges/${challengeId}/versions/1/preview`, sessionHeaders(memberSessionId)],
    [`http://127.0.0.1:${port}/author/challenges/${challengeId}/versions/not-a-number/preview`, sessionHeaders(authorSessionId)],
    [`http://127.0.0.1:${port}/author/challenges/${challengeId}/versions/999/preview`, sessionHeaders(authorSessionId)],
    [`http://127.0.0.1:${port}/author/challenges/${challengeId}/versions/2/preview`, sessionHeaders(authorSessionId)],
  ];
  for (const [url, headers] of requests) {
    const response = await fetch(url, { headers });
    assert.equal(response.status, 404, `expected 404 for ${url}`);
  }
});

test('previewing does not change the enrollments row count', async () => {
  const before = await db.select().from(enrollments);
  await fetch(`http://127.0.0.1:${port}/author/challenges/${challengeId}/versions/1/preview`, { headers: sessionHeaders(authorSessionId) });
  const after = await db.select().from(enrollments);

  assert.equal(after.length, before.length);
});
