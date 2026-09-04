import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { createSession, SESSION_COOKIE } from '../../../modules/identity/index.js';

const { users, sessions, challenges, challengeVersions, comments, stacks, challengeStacks } = schema;
const testDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDir, '..', '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3418;
const { db, pool } = createDbClient(databaseUrl);

let challengeId: string | undefined;
let versionId: string | undefined;
let server: ChildProcess | undefined;
let fixtureServer: Server | undefined;
let fixtureUrl: string | undefined;
let userId: string | undefined;
let sessionId: string | undefined;
let stackId: string | undefined;
let challengeStackId: string | undefined;
const commentIds: string[] = [];

async function waitForServer(url: string, attempts: number): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`server at ${url} did not become ready`);
}

async function startFixtureServer(): Promise<{ server: Server; url: string }> {
  const yaml = await readFile(path.join(testDir, 'fixtures', 'openapi.yaml'), 'utf-8');
  return new Promise((resolve) => {
    const httpServer = createServer((req, res) => {
      if (req.url === '/openapi.yaml') {
        res.writeHead(200, { 'content-type': 'application/yaml' });
        res.end(yaml);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      const listenPort = typeof address === 'object' && address ? address.port : 0;
      resolve({ server: httpServer, url: `http://127.0.0.1:${listenPort}/openapi.yaml` });
    });
  });
}

before(async () => {
  const fixture = await startFixtureServer();
  fixtureServer = fixture.server;
  fixtureUrl = fixture.url;

  const [challenge] = await db.insert(challenges).values({ title: 'Challenge detail page fixture', level: 'mid' }).returning();
  challengeId = challenge.id;
  const [version] = await db.insert(challengeVersions).values({
    challengeId,
    version: 1,
    level: 'mid',
    brief: 'Build a small items API with full CRUD.',
    rubric: { functional: 60, contract: 15, robustness: 15, quality: 10 },
    openapiRef: fixtureUrl,
    hiddenTestsRef: 'hidden/v1',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
  }).returning();
  versionId = version.id;

  assert.ok(challengeId);
  const [stack] = await db.insert(stacks).values({ language: 'Python', framework: 'FastAPI', templateKey: 'python-fastapi' }).returning();
  stackId = stack.id;
  const [challengeStack] = await db.insert(challengeStacks).values({ challengeId, stackId }).returning();
  challengeStackId = challengeStack.id;

  const [user] = await db.insert(users).values({
    githubId: Math.floor(Math.random() * 1_000_000_000),
    handle: `challenge-comments-${randomUUID()}`,
    displayName: 'Challenge Comments Member',
    email: `challenge-comments-${randomUUID()}@example.com`,
    role: 'member',
  }).returning();
  userId = user.id;
  const session = await createSession(user.id, databaseUrl);
  sessionId = session.id;
  const insertedComments = await db.insert(comments).values([
    { targetType: 'challenge', targetId: challenge.id, authorId: user.id, body: 'Earlier challenge comment', createdAt: new Date('2026-01-02T00:00:00Z') },
    { targetType: 'challenge', targetId: challenge.id, authorId: user.id, body: 'Later challenge comment', createdAt: new Date('2026-01-03T00:00:00Z') },
  ]).returning();
  commentIds.push(...insertedComments.map((comment) => comment.id));

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });
  server = spawn('node', ['.next/standalone/apps/web/server.js'], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' },
  });
  await waitForServer(`http://127.0.0.1:${port}/challenges/${challengeId}`, 20);
});

after(async () => {
  if (server) server.kill();
  if (fixtureServer) fixtureServer.close();
  for (const id of commentIds) await db.delete(comments).where(eq(comments.id, id));
  if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
  if (challengeStackId) await db.delete(challengeStacks).where(eq(challengeStacks.id, challengeStackId));
  if (stackId) await db.delete(stacks).where(eq(stacks.id, stackId));
  if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
  if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

test('GET /challenges/:id shows the challenge and sign-in prompt to a signed-out visitor', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges/${challengeId}`);
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(body.includes('Challenge detail page fixture'));
  assert.ok(body.includes('Sign in with GitHub to start this challenge.'));
  assert.ok(!body.includes('Start challenge'));
  assert.ok(body.indexOf('Earlier challenge comment') < body.indexOf('Later challenge comment'));
  assert.ok(!body.includes('Add a comment'));
  assert.ok(!body.includes('Post comment'));
});

test('GET /challenges/:id shows the comment form to a signed-in member', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges/${challengeId}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${sessionId}` },
  });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(body.includes('Add a comment'));
  assert.ok(body.includes('Post comment'));
});

test('GET /challenges/:id offers a signed-in member the option to start the challenge with an enabled stack', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges/${challengeId}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${sessionId}` },
  });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(body.includes('Start challenge'));
  assert.ok(!body.includes('No stacks are enabled for this challenge yet.'));
});

test('GET /challenges/:id returns 404 for an unknown challenge', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges/${randomUUID()}`);
  assert.equal(res.status, 404);
});

test('GET /challenges/:id shows the brief and the four rubric weights for a published challenge version', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges/${challengeId}`);
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.match(body, /Build a small items API with full CRUD\./);
  assert.match(body, /<dd>60<\/dd>/);
  assert.equal((body.match(/<dd>15<\/dd>/g) ?? []).length, 2);
  assert.match(body, /<dd>10<\/dd>/);
});

test('GET /challenges/:id returns 404 when the challenge has no published version', async () => {
  let draftChallengeId: string | undefined;
  let draftVersionId: string | undefined;
  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Draft challenge', level: 'junior' }).returning();
    draftChallengeId = challenge.id;
    const [version] = await db.insert(challengeVersions).values({
      challengeId: draftChallengeId,
      version: 1,
      level: 'junior',
      brief: 'Not visible yet.',
      rubric: { functional: 60, contract: 15, robustness: 15, quality: 10 },
      openapiRef: 'openapi/v1.yaml',
      hiddenTestsRef: 'hidden/v1',
    }).returning();
    draftVersionId = version.id;

    const res = await fetch(`http://127.0.0.1:${port}/challenges/${draftChallengeId}`);
    assert.equal(res.status, 404);
  } finally {
    if (draftVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, draftVersionId));
    if (draftChallengeId) await db.delete(challenges).where(eq(challenges.id, draftChallengeId));
  }
});
