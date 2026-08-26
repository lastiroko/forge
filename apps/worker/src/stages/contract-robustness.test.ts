import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadOpenApiDocument,
  checkContractConformance,
  runRobustnessChecks,
  runContractRobustnessChecks,
  type OpenApiDocument,
} from './contract-robustness.js';

async function createWorkspace(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'forge-contract-robustness-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}

const widgetsSpec: OpenApiDocument = {
  paths: {
    '/widgets': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { type: 'object', required: ['id', 'name'] },
              },
            },
          },
        },
      },
    },
  },
};

function startWidgetsServer(body: unknown, status = 200): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/widgets') {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
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

test('checkContractConformance fails when a required field is missing from the response', async (t) => {
  const { server, port } = await startWidgetsServer({ name: 'Widget' });
  t.after(() => server.close());

  const checks = await checkContractConformance('http://127.0.0.1:' + port, widgetsSpec, [
    { name: 'get-widgets', method: 'GET', path: '/widgets' },
  ]);

  assert.equal(checks.length, 1);
  assert.equal(checks[0].passed, false);
  assert.ok(checks[0].message?.includes('id'));
});

test('checkContractConformance passes when all required fields are present', async (t) => {
  const { server, port } = await startWidgetsServer({ id: '1', name: 'Widget' });
  t.after(() => server.close());

  const checks = await checkContractConformance('http://127.0.0.1:' + port, widgetsSpec, [
    { name: 'get-widgets', method: 'GET', path: '/widgets' },
  ]);

  assert.equal(checks[0].passed, true);
});

test('checkContractConformance fails when no operation is defined for the request', async (t) => {
  const { server, port } = await startWidgetsServer({ id: '1', name: 'Widget' });
  t.after(() => server.close());

  const checks = await checkContractConformance('http://127.0.0.1:' + port, widgetsSpec, [
    { name: 'get-missing', method: 'GET', path: '/missing' },
  ]);

  assert.equal(checks[0].passed, false);
  assert.ok(checks[0].message?.includes('no operation defined'));
});

test('checkContractConformance fails when the response status has no matching definition', async (t) => {
  const { server, port } = await startWidgetsServer({ id: '1', name: 'Widget' }, 404);
  t.after(() => server.close());

  const checks = await checkContractConformance('http://127.0.0.1:' + port, widgetsSpec, [
    { name: 'get-widgets', method: 'GET', path: '/widgets' },
  ]);

  assert.equal(checks[0].passed, false);
  assert.ok(checks[0].message?.includes('404'));
});

test('checkContractConformance fails when the server cannot be reached', async () => {
  const checks = await checkContractConformance('http://127.0.0.1:1', widgetsSpec, [
    { name: 'get-widgets', method: 'GET', path: '/widgets' },
  ]);

  assert.equal(checks[0].passed, false);
  assert.ok(checks[0].message?.includes('could not reach'));
});

test('loadOpenApiDocument fails when openapi.yaml is missing', async (t) => {
  const dir = await createWorkspace({});
  t.after(() => rm(dir, { recursive: true, force: true }));

  await assert.rejects(loadOpenApiDocument(dir), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes('openapi.yaml'));
    return true;
  });
});

test('loadOpenApiDocument fails when openapi.yaml is not valid YAML', async (t) => {
  const dir = await createWorkspace({ 'openapi.yaml': 'paths:\n  /widgets:\n\tget: broken\n' });
  t.after(() => rm(dir, { recursive: true, force: true }));

  await assert.rejects(loadOpenApiDocument(dir), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes('not valid YAML'));
    return true;
  });
});

test('loadOpenApiDocument resolves with the parsed document for a valid fixture', async (t) => {
  const openapiYaml =
    'paths:\n' +
    '  /widgets:\n' +
    '    get:\n' +
    '      responses:\n' +
    "        '200':\n" +
    '          content:\n' +
    '            application/json:\n' +
    '              schema:\n' +
    '                type: object\n' +
    '                required:\n' +
    '                  - id\n' +
    '                  - name\n';
  const dir = await createWorkspace({ 'openapi.yaml': openapiYaml });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await loadOpenApiDocument(dir);

  assert.deepEqual(result, widgetsSpec);
});

function startRobustnessServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        if (req.url === '/widgets') {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = undefined;
          }
          if (typeof parsed === 'object' && parsed !== null) {
            res.writeHead(200);
            res.end();
          } else {
            res.writeHead(400);
            res.end();
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

test('runRobustnessChecks passes when a malformed-input probe gets the expected status', async (t) => {
  const { server, port } = await startRobustnessServer();
  t.after(() => server.close());

  const checks = await runRobustnessChecks('http://127.0.0.1:' + port, [
    { name: 'malformed-body', method: 'POST', path: '/widgets', body: 'not-an-object', expectedStatuses: [400] },
  ]);

  assert.equal(checks[0].passed, true);
});

test('runRobustnessChecks fails with actual and expected status when the probe gets an unexpected status', async (t) => {
  const { server, port } = await startRobustnessServer();
  t.after(() => server.close());

  const checks = await runRobustnessChecks('http://127.0.0.1:' + port, [
    { name: 'well-formed-body', method: 'POST', path: '/widgets', body: {}, expectedStatuses: [400] },
  ]);

  assert.equal(checks[0].passed, false);
  assert.ok(checks[0].message?.includes('200'));
  assert.ok(checks[0].message?.includes('400'));
});

test('runRobustnessChecks fails when the server cannot be reached', async () => {
  const checks = await runRobustnessChecks('http://127.0.0.1:1', [
    { name: 'unreachable', method: 'GET', path: '/widgets', expectedStatuses: [200] },
  ]);

  assert.equal(checks[0].passed, false);
  assert.ok(checks[0].message?.includes('could not reach'));
});

test('runContractRobustnessChecks computes pass rates from contract and robustness checks', async (t) => {
  const { server, port } = await startWidgetsServer({ name: 'Widget' });
  t.after(() => server.close());

  const result = await runContractRobustnessChecks(
    'http://127.0.0.1:' + port,
    widgetsSpec,
    [{ name: 'get-widgets', method: 'GET', path: '/widgets' }],
    [
      { name: 'probe-one', method: 'GET', path: '/widgets', expectedStatuses: [200] },
      { name: 'probe-two', method: 'GET', path: '/widgets', expectedStatuses: [200] },
    ],
  );

  assert.equal(result.contractPassRate, 0);
  assert.equal(result.robustnessPassRate, 1);
});

test('runContractRobustnessChecks treats empty request and probe lists as a full pass rate', async () => {
  const result = await runContractRobustnessChecks('http://127.0.0.1:1', widgetsSpec, [], []);

  assert.equal(result.contractPassRate, 1);
  assert.equal(result.robustnessPassRate, 1);
});
