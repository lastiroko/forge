import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Challenge } from '../lib/challenge-schema.js';
import { startRun } from './start.js';

const execFileAsync = promisify(execFile);

function makeChallenge(services: string[]): Challenge {
  return {
    slug: 'sample-challenge',
    level: 'junior',
    rubric: { functional: 60, contract: 15, robustness: 15, quality: 10 },
    services,
  };
}

test('starts an internal network with the service and app containers running', async (t) => {
  const result = await startRun('hello-world:latest', makeChallenge(['postgres']));
  t.after(result.teardown);

  const { stdout } = await execFileAsync('docker', [
    'network',
    'inspect',
    result.networkName,
    '--format',
    '{{json .Internal}}',
  ]);
  assert.equal(stdout.trim(), 'true');
  assert.equal(result.serviceContainerIds.length, 1);
  assert.ok(result.appContainerId);
});

test('an outbound request from a container on the run network fails', async (t) => {
  const result = await startRun('hello-world:latest', makeChallenge([]));
  t.after(result.teardown);

  await assert.rejects(
    execFileAsync('docker', [
      'run',
      '--rm',
      '--network',
      result.networkName,
      'alpine:3.20',
      'wget',
      '--timeout=3',
      '-O',
      '-',
      'http://example.com',
    ]),
  );
});

test('each run gets unique, throwaway database credentials', async (t) => {
  const challenge = makeChallenge(['postgres']);
  const first = await startRun('hello-world:latest', challenge);
  const second = await startRun('hello-world:latest', challenge);
  t.after(async () => {
    await first.teardown();
    await second.teardown();
  });

  assert.notEqual(first.databaseCredentials.username, second.databaseCredentials.username);
  assert.notEqual(first.databaseCredentials.password, second.databaseCredentials.password);
  assert.notEqual(first.databaseCredentials.database, second.databaseCredentials.database);
});

test('rejects a challenge that declares an unsupported service', async () => {
  await assert.rejects(startRun('hello-world:latest', makeChallenge(['redis'])), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes('redis'));
    return true;
  });
});
