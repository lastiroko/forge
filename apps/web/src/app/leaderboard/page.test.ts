import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';

const { users, leaderboardSnapshots } = schema;

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3419;

const { db, pool } = createDbClient(databaseUrl);

const fixtureStackId = randomUUID();
const userIds: string[] = [];
const snapshotIds: string[] = [];
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
  const [highUser] = await db.insert(users).values({
    githubId: Date.now(), handle: `HighScorer-${Date.now()}`, displayName: 'High Scorer', email: `high-${Date.now()}@example.com`, role: 'member',
  }).returning();
  const [lowUser] = await db.insert(users).values({
    githubId: Date.now() + 1, handle: `LowScorer-${Date.now()}`, displayName: 'Low Scorer', email: `low-${Date.now()}@example.com`, role: 'member',
  }).returning();
  const [stackUser] = await db.insert(users).values({
    githubId: Date.now() + 2, handle: `StackScorer-${Date.now()}`, displayName: 'Stack Scorer', email: `stack-${Date.now()}@example.com`, role: 'member',
  }).returning();
  userIds.push(highUser.id, lowUser.id, stackUser.id);

  const snapshotRows = await db.insert(leaderboardSnapshots).values([
    { scope: 'global', stackId: null, userId: highUser.id, totalPoints: 500, rank: 1 },
    { scope: 'global', stackId: null, userId: lowUser.id, totalPoints: 50, rank: 2 },
    { scope: 'stack', stackId: fixtureStackId, userId: stackUser.id, totalPoints: 300, rank: 1 },
  ]).returning();
  snapshotIds.push(...snapshotRows.map((row) => row.id));

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });

  server = spawn('node', ['.next/standalone/apps/web/server.js'], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' },
  });

  await waitForServer(`http://127.0.0.1:${port}/leaderboard`, 20);
});

after(async () => {
  if (server) server.kill();
  if (snapshotIds.length) await db.delete(leaderboardSnapshots).where(inArray(leaderboardSnapshots.id, snapshotIds));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

test('GET /leaderboard lists global members ordered by points descending', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/leaderboard`);
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(body.includes('HighScorer'));
  assert.ok(body.includes('LowScorer'));
  assert.ok(body.indexOf('HighScorer') < body.indexOf('LowScorer'));
  assert.ok(!body.includes('StackScorer'));
});

test('GET /leaderboard/[stack] lists only that stack scope members', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/leaderboard/${fixtureStackId}`);
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(body.includes('StackScorer'));
  assert.ok(!body.includes('HighScorer'));
});
