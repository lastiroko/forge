import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';

const { challenges, challengeVersions } = schema;

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3417;

const { db, pool } = createDbClient(databaseUrl);

let juniorChallengeId: string | undefined;
let juniorVersionId: string | undefined;
let midChallengeId: string | undefined;
let midVersionId: string | undefined;
let server: ChildProcess | undefined;

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

before(async () => {
  const [juniorChallenge] = await db.insert(challenges).values({ title: 'Page test junior challenge', level: 'junior' }).returning();
  juniorChallengeId = juniorChallenge.id;
  const [juniorVersion] = await db.insert(challengeVersions).values({
    challengeId: juniorChallengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
  }).returning();
  juniorVersionId = juniorVersion.id;

  const [midChallenge] = await db.insert(challenges).values({ title: 'Page test mid challenge', level: 'mid' }).returning();
  midChallengeId = midChallenge.id;
  const [midVersion] = await db.insert(challengeVersions).values({
    challengeId: midChallengeId, version: 1, level: 'mid', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
  }).returning();
  midVersionId = midVersion.id;

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });

  server = spawn('node', ['.next/standalone/apps/web/server.js'], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' },
  });

  await waitForServer(`http://127.0.0.1:${port}/challenges`, 20);
});

after(async () => {
  if (server) server.kill();
  if (juniorVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, juniorVersionId));
  if (midVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, midVersionId));
  if (juniorChallengeId) await db.delete(challenges).where(eq(challenges.id, juniorChallengeId));
  if (midChallengeId) await db.delete(challenges).where(eq(challenges.id, midChallengeId));
  await pool.end();
});

test('GET /challenges lists every published challenge', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges`);
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(body.includes('Page test junior challenge'));
  assert.ok(body.includes('Page test mid challenge'));
});

test('GET /challenges?level=junior lists only the junior challenge', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges?level=junior`);
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(body.includes('Page test junior challenge'));
  assert.ok(!body.includes('Page test mid challenge'));
});
