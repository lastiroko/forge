import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map((entry) => path.join(dir, entry.toString()));
}

test('no source file under src/app configures the edge runtime', () => {
  const offenders = listFiles(path.join(webRoot, 'src', 'app'))
    .filter((file) => /\.(ts|tsx|js)$/.test(file))
    .filter((file) => existsSync(file) && /runtime\s*=\s*['"]edge['"]/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('next build produces a standalone server bundle', () => {
  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });

  const appServerPath = path.join(webRoot, '.next', 'standalone', 'apps', 'web', 'server.js');
  assert.ok(existsSync(appServerPath), `expected standalone app server at ${appServerPath}`);

  const serverJs = readFileSync(appServerPath, 'utf8');
  assert.ok(serverJs.length > 0, 'standalone server.js should not be empty');
  assert.ok(/require|import/.test(serverJs), 'standalone server.js should be a real Node module');
});
