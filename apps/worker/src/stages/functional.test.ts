import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { runFunctionalChecks } from './functional.js';

function startFixtureServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/public-fail' || req.url === '/hidden-fail') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed' }));
      } else if (req.url === '/public-pass' || req.url === '/hidden-pass') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
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

test('runFunctionalChecks preserves public failure detail and strips hidden failure detail', async (t) => {
  const { server, port } = await startFixtureServer();
  t.after(() => server.close());
  const result = await runFunctionalChecks(
    'http://127.0.0.1:' + port,
    [{ name: 'public-check', request: { method: 'GET', path: '/public-fail' }, expect: { status: 200 } }],
    [{ name: 'hidden-check', request: { method: 'GET', path: '/hidden-fail' }, expect: { status: 200 } }],
  );
  assert.equal(result.publicChecks[0].passed, false);
  assert.ok('request' in result.publicChecks[0]);
  assert.ok('response' in result.publicChecks[0]);
  assert.equal(result.hiddenChecks[0].passed, false);
  assert.equal('request' in result.hiddenChecks[0], false);
  assert.equal('response' in result.hiddenChecks[0], false);
  assert.deepEqual(Object.keys(result.hiddenChecks[0]), ['name', 'passed', 'message']);
});

test('runFunctionalChecks returns passed results for successful public and hidden checks', async (t) => {
  const { server, port } = await startFixtureServer();
  t.after(() => server.close());
  const result = await runFunctionalChecks(
    'http://127.0.0.1:' + port,
    [{ name: 'public-check', request: { method: 'GET', path: '/public-pass' }, expect: { status: 200 } }],
    [{ name: 'hidden-check', request: { method: 'GET', path: '/hidden-pass' }, expect: { status: 200 } }],
  );
  assert.equal(result.publicChecks[0].passed, true);
  assert.equal(result.hiddenChecks[0].passed, true);
});
