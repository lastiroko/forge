import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
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

test('next build produces a standalone server that serves the home page with 200', async () => {
  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });

  const servers = listFiles(path.join(webRoot, '.next', 'standalone')).filter(
    (file) => path.basename(file) === 'server.js',
  );
  assert.equal(servers.length, 1, `expected exactly one standalone server.js, found: ${JSON.stringify(servers)}`);

  const port = 3100;
  const server = spawn('npx', ['next', 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: webRoot });

  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(res.status, 200);
        break;
      } catch (err) {
        if (Date.now() > deadline) throw new Error(`server never became ready: ${err}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  } finally {
    server.kill();
  }
});
