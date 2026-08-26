import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createInternalNetwork, runContainer } from '../lib/docker.js';
import { teardownRun } from './teardown.js';

const execFileAsync = promisify(execFile);

test('removes a created network and container, leaving no trace of either', async () => {
  const runId = randomUUID();
  const networkName = `forge-run-${runId}`;
  const containerName = `forge-run-${runId}-app`;

  await createInternalNetwork(networkName);
  await runContainer({ image: 'hello-world:latest', name: containerName, network: networkName, env: [] });

  await teardownRun({ networkName, containerNames: [containerName] });

  await assert.rejects(execFileAsync('docker', ['network', 'inspect', networkName]));
  await assert.rejects(execFileAsync('docker', ['inspect', containerName]));
});

test('resolves without throwing when called with no arguments', async () => {
  await assert.doesNotReject(teardownRun({}));
});

test('resolves without throwing when given names that were never created', async () => {
  const runId = randomUUID();
  await assert.doesNotReject(
    teardownRun({
      networkName: `forge-run-${runId}`,
      containerNames: [`forge-run-${runId}-app`, `forge-run-${runId}-postgres`],
    }),
  );
});
