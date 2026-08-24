import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { buildImage } from './build.js';

const execFileAsync = promisify(execFile);

async function createWorkspace(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'forge-build-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}

function startFixtureRegistry(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/pkg.tgz') {
        res.writeHead(200);
        res.end('fixture-package-bytes');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

function startFixtureProxy(): Promise<{ server: Server; port: number; requests: string[] }> {
  return new Promise((resolve) => {
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(req.url ?? '');
      const target = new URL(req.url ?? '');
      const proxyReq = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.pathname + target.search,
          method: req.method,
          headers: req.headers,
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      req.pipe(proxyReq);
    });
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port, requests });
    });
  });
}

test('builds a fixture image that installs a dependency through the allowlisted proxy', async (t) => {
  const registry = await startFixtureRegistry();
  const proxy = await startFixtureProxy();
  t.after(() => {
    registry.server.close();
    proxy.server.close();
  });

  const dir = await createWorkspace({
    Dockerfile: `FROM alpine:3.20\nRUN wget -O /tmp/pkg http://127.0.0.1:${registry.port}/pkg.tgz\n`,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await buildImage(dir, 'junior', 'http://host.docker.internal:' + proxy.port);
  t.after(() => execFileAsync('docker', ['rmi', '-f', result.imageTag]).catch(() => {}));

  assert.match(result.imageTag, /^forge-submission-/);
  assert.ok(proxy.requests.some((url) => url.includes('/pkg.tgz')));
});

test('fails within the configured timeout when the build hangs', async (t) => {
  const dir = await createWorkspace({
    Dockerfile: 'FROM alpine:3.20\nRUN sleep 30\n',
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const start = Date.now();
  await assert.rejects(
    buildImage(dir, 'junior', 'http://127.0.0.1:1', { timeoutMs: 2000 }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('Build stage'));
      return true;
    },
  );
  assert.ok(Date.now() - start < 15000);
});
