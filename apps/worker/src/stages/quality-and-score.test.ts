import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { computeScore, runQualitySignalChecks, runQualityAndScore } from './quality-and-score.js';

function startFixtureServer(healthDelayMs = 0): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/health') {
        setTimeout(() => {
          res.writeHead(200);
          res.end('ok');
        }, healthDelayMs);
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

test('computeScore computes 90 when functional, contract and robustness pass fully and quality is 0, with default rubric weights', () => {
  const result = computeScore(
    { functional: 1, contract: 1, robustness: 1, quality: 0 },
    { functional: 60, contract: 15, robustness: 15, quality: 10 },
  );
  assert.equal(result, 90);
});

test('computeScore applies equal-weight rubric overrides', () => {
  const fullPass = computeScore(
    { functional: 1, contract: 1, robustness: 1, quality: 0 },
    { functional: 25, contract: 25, robustness: 25, quality: 25 },
  );
  assert.equal(fullPass, 75);

  const halfPass = computeScore(
    { functional: 0.5, contract: 0.5, robustness: 0.5, quality: 0.5 },
    { functional: 25, contract: 25, robustness: 25, quality: 25 },
  );
  assert.equal(halfPass, 50);
});

test('runQualitySignalChecks passes the response-time check when /health responds quickly', async (t) => {
  const { server, port } = await startFixtureServer();
  t.after(() => server.close());

  const checks = await runQualitySignalChecks('http://127.0.0.1:' + port, '{"level":"info"}\n');
  const responseTimeCheck = checks.find((c) => c.name === 'response-time');
  assert.ok(responseTimeCheck);
  assert.equal(responseTimeCheck.passed, true);
});

test('runQualitySignalChecks fails the response-time check when /health is slower than the limit', async (t) => {
  const { server, port } = await startFixtureServer(50);
  t.after(() => server.close());

  const checks = await runQualitySignalChecks('http://127.0.0.1:' + port, '{}', { responseTimeLimitMs: 10 });
  const responseTimeCheck = checks.find((c) => c.name === 'response-time');
  assert.ok(responseTimeCheck);
  assert.equal(responseTimeCheck.passed, false);
  assert.ok(responseTimeCheck.message?.includes('took'));
});

test('runQualitySignalChecks passes the structured-logging check when most log lines are JSON', async (t) => {
  const { server, port } = await startFixtureServer();
  t.after(() => server.close());

  const checks = await runQualitySignalChecks(
    'http://127.0.0.1:' + port,
    '{"level":"info","msg":"start"}\n{"level":"info","msg":"ready"}\n',
  );
  const structuredLoggingCheck = checks.find((c) => c.name === 'structured-logging');
  assert.ok(structuredLoggingCheck);
  assert.equal(structuredLoggingCheck.passed, true);
});

test('runQualitySignalChecks fails the structured-logging check when logs are plain text', async (t) => {
  const { server, port } = await startFixtureServer();
  t.after(() => server.close());

  const checks = await runQualitySignalChecks('http://127.0.0.1:' + port, 'starting server\nlistening on port 3000\n');
  const structuredLoggingCheck = checks.find((c) => c.name === 'structured-logging');
  assert.ok(structuredLoggingCheck);
  assert.equal(structuredLoggingCheck.passed, false);
});

test('runQualityAndScore combines suite pass rates and quality checks into a score', async (t) => {
  const { server, port } = await startFixtureServer();
  t.after(() => server.close());

  const result = await runQualityAndScore(
    'http://127.0.0.1:' + port,
    '{"level":"info"}\n',
    { functional: 1, contract: 1, robustness: 1 },
    { functional: 60, contract: 15, robustness: 15, quality: 10 },
  );

  assert.equal(result.qualityPassRate, 1);
  assert.equal(result.score, 100);
});
