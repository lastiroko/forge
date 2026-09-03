import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';

const { challenges, challengeVersions } = schema;
const testDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDir, '..', '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3422;
const { db, pool } = createDbClient(databaseUrl);

let challengeId: string | undefined;
let versionId: string | undefined;
let server: ChildProcess | undefined;
let fixtureServer: Server | undefined;
let fixtureUrl: string | undefined;

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

  const [challenge] = await db.insert(challenges).values({ title: 'OpenAPI contract fixture challenge', level: 'mid' }).returning();
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
  if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
  if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
  await pool.end();
});

test('GET /challenges/:id renders every path and method from the OpenAPI fixture', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges/${challengeId}`);
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.match(body, /API contract/);

  assert.match(body, /GET\s*\/items(?!\/)/);
  assert.match(body, /POST\s*\/items(?!\/)/);
  assert.match(body, /GET\s*\/items\/\{itemId\}/);
  assert.match(body, /DELETE\s*\/items\/\{itemId\}/);
});

test('GET /challenges/:id shows readable parameter, request-body, and response details', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges/${challengeId}`);
  const body = await res.text();

  assert.equal(res.status, 200);

  assert.match(body, /limit/);
  assert.match(body, /query/);
  assert.match(body, /itemId/);
  assert.match(body, /path/);

  assert.match(body, /201/);
  assert.match(body, /404/);
  assert.match(body, /Item not found/);

  assert.match(body, /tags/);
  assert.match(body, /array/);

  assert.match(body, /name/);
  assert.match(body, /description/);
});

test('GET /challenges/:id does not render the OpenAPI contract as raw YAML', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges/${challengeId}`);
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(!body.includes('openapi: 3.0.3'));
  assert.ok(!body.includes('components:'));
  assert.ok(!body.includes('$ref:'));
});
