import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { runCheckSuite, type HttpCheck } from './check-runner.js';

function startFixtureServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/widgets') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ count: 2 }));
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

test('runCheckSuite returns one passed and one failed result carrying the configured failure message', async (t) => {
  const { server, port } = await startFixtureServer();
  t.after(() => server.close());

  const checks: HttpCheck[] = [
    {
      name: 'widgets-ok',
      request: { method: 'GET', path: '/widgets' },
      expect: (res) => res.status === 200 && (res.body as { count: number }).count === 2,
      failureMessage: 'expected widgets count to be 2',
    },
    {
      name: 'widgets-wrong-count',
      request: { method: 'GET', path: '/widgets' },
      expect: (res) => (res.body as { count: number }).count === 999,
      failureMessage: 'expected widgets count to be 999',
    },
  ];

  const results = await runCheckSuite('http://127.0.0.1:' + port, checks);

  assert.equal(results.length, 2);

  const ok = results.find((result) => result.name === 'widgets-ok');
  assert.ok(ok);
  assert.equal(ok?.passed, true);

  const wrong = results.find((result) => result.name === 'widgets-wrong-count');
  assert.ok(wrong);
  assert.equal(wrong?.passed, false);
  assert.equal(wrong?.message, 'expected widgets count to be 999');
});
