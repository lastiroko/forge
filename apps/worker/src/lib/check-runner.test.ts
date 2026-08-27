import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { runCheck } from './check-runner.js';

function startFixtureServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/widgets') {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ count: 2 }));
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

test('runCheck passes with request and response detail when status and body match', async (t) => {
  const { server, port } = await startFixtureServer();
  t.after(() => server.close());
  const request = { method: 'GET', path: '/widgets' };
  const result = await runCheck('http://127.0.0.1:' + port, {
    name: 'widgets-ok', request, expect: { status: 201, body: { count: 2 } },
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.request, request);
  assert.deepEqual(result.response, { status: 201, body: { count: 2 } });
});

test('runCheck fails with a message and response detail when status does not match', async (t) => {
  const { server, port } = await startFixtureServer();
  t.after(() => server.close());
  const result = await runCheck('http://127.0.0.1:' + port, {
    name: 'widgets-status', request: { method: 'GET', path: '/widgets' }, expect: { status: 200 },
  });
  assert.equal(result.passed, false);
  assert.equal(result.message, 'expected status 200, got 201');
  assert.deepEqual(result.response, { status: 201, body: { count: 2 } });
});

test('runCheck fails with a message and no response detail when the request fails', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  const result = await runCheck('http://127.0.0.1:' + port, {
    name: 'unreachable', request: { method: 'GET', path: '/widgets' }, expect: { status: 200 },
  });
  assert.equal(result.passed, false);
  assert.ok(result.message?.startsWith('request failed: '));
  assert.equal('response' in result, false);
});
