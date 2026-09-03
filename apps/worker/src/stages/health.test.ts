import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:http';
import { waitForHealth } from './health.js';

const execFileAsync = promisify(execFile);

function startFixtureServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end('{"status":"ok"}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 });
    });
  });
}

test('waitForHealth resolves once the fixture app answers 200 within a second', async (t) => {
  const { server, port } = await startFixtureServer();
  t.after(() => server.close());

  await assert.doesNotReject(
    waitForHealth('http://127.0.0.1:' + port, 'unused-container-id', {
      timeoutMs: 5000,
      pollIntervalMs: 100,
    }),
  );
});

test('waitForHealth rejects with a timeout message and captured logs when the app never answers', async (t) => {
  const containerName = 'forge-health-test-' + Date.now();
  await execFileAsync('docker', [
    'run',
    '-d',
    '--name',
    containerName,
    'alpine:3.20',
    'sh',
    '-c',
    'echo forge-health-fixture-marker && sleep 30',
  ]);
  t.after(() => execFileAsync('docker', ['rm', '--force', containerName]).catch(() => {}));

  const start = Date.now();
  await assert.rejects(
    waitForHealth('http://127.0.0.1:1', containerName, { timeoutMs: 1500, pollIntervalMs: 100 }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /timeout/i);
      assert.ok(error.message.includes('forge-health-fixture-marker'));
      return true;
    },
  );
  assert.ok(Date.now() - start < 10000);
});

test('waitForHealth enforces the timeout when a server accepts but never responds', async (t) => {
  const server = createServer(() => {
    // Deliberately leave the response open to simulate a hung application.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const start = Date.now();
  await assert.rejects(
    waitForHealth('http://127.0.0.1:' + port, 'missing-container-id', {
      timeoutMs: 250,
      pollIntervalMs: 25,
    }),
    /timeout/i,
  );
  assert.ok(Date.now() - start < 2000);
});
