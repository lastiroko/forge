import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dockerfile = readFileSync(path.join(webRoot, 'Dockerfile'), 'utf8');

test('Dockerfile has deps, builder, and runtime stages', () => {
  assert.match(dockerfile, /AS deps/);
  assert.match(dockerfile, /AS builder/);
  assert.match(dockerfile, /AS runtime/);
});

test('Dockerfile runs as a non-root user', () => {
  assert.match(dockerfile, /USER node/);
});

test('Dockerfile listens on a configured PORT', () => {
  assert.match(dockerfile, /ENV PORT/);
});
