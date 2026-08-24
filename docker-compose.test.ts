import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const compose = readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
const envExample = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');

test('docker-compose.yml declares all five services', () => {
  assert.match(compose, /^ {2}postgres:/m);
  assert.match(compose, /^ {2}minio:/m);
  assert.match(compose, /^ {2}mailpit:/m);
  assert.match(compose, /^ {2}web:/m);
  assert.match(compose, /^ {2}worker:/m);
});

test('web and worker build from their own Dockerfiles', () => {
  assert.match(compose, /dockerfile: apps\/web\/Dockerfile/);
  assert.match(compose, /dockerfile: apps\/worker\/Dockerfile/);
});

test('postgres has a pg_isready healthcheck and web/worker wait for it to be healthy', () => {
  assert.match(compose, /pg_isready/);
  const healthyMatches = compose.match(/condition: service_healthy/g) ?? [];
  assert.equal(healthyMatches.length, 2);
});

test('worker mounts the host Docker socket', () => {
  assert.match(compose, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
});

test('web and worker read DATABASE_URL and PORT with defaults', () => {
  const databaseUrlMatches = compose.match(/\$\{DATABASE_URL:-/g) ?? [];
  const portMatches = compose.match(/\$\{PORT:-3000\}/g) ?? [];
  assert.equal(databaseUrlMatches.length, 2);
  assert.equal(portMatches.length, 2);
});

test('.env.example documents DATABASE_URL and PORT', () => {
  assert.match(envExample, /^DATABASE_URL=/m);
  assert.match(envExample, /^PORT=/m);
});
