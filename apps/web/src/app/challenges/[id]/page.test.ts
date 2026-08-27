import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';

const { challenges, challengeVersions } = schema;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3418;
const { db, pool } = createDbClient(databaseUrl);

let challengeId: string | undefined;
let versionId: string | undefined;
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
  const [challenge] = await db.insert(challenges).values({ title: 'Challenge detail page fixture', level: 'mid' }).returning();
  challengeId = challenge.id;
  const [version] = await db.insert(challengeVersions).values({
    challengeId, version: 1, level: 'mid', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date('2026-01-01T00:00:00Z'),
  }).returning();
  versionId = version.id;

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });
  server = spawn('node', ['.next/standalone/apps/web/server.js'], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' },
  });
  await waitForServer(`http://127.0.0.1:${port}/challenges/${challengeId}`, 20);
});

after(async () => {
  if (server) server.kill();
  if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
  if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
  await pool.end();
});

test('GET /challenges/:id shows the challenge and sign-in prompt to a signed-out visitor', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges/${challengeId}`);
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(body.includes('Challenge detail page fixture'));
  assert.ok(body.includes('Sign in with GitHub to start this challenge.'));
  assert.ok(!body.includes('Start challenge'));
});

test('GET /challenges/:id returns 404 for an unknown challenge', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges/${randomUUID()}`);
  assert.equal(res.status, 404);
});
