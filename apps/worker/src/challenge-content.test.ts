import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorkspace } from './stages/validate.js';
import { buildImage } from './stages/build.js';
import { startRun } from './stages/start.js';
import { runFunctionalChecks } from './stages/functional.js';
import {
  runContractRobustnessChecks,
  loadOpenApiDocument,
  type ContractCheckRequest,
  type RobustnessProbe,
} from './stages/contract-robustness.js';
import { runQualityAndScore } from './stages/quality-and-score.js';
import type { FunctionalCheckDefinition } from './lib/check-runner.js';

const execFileAsync = promisify(execFile);

const challengeDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'challenges',
  'todo-api',
);

async function readJson<T>(relativePath: string): Promise<T> {
  const raw = await readFile(path.join(challengeDir, relativePath), 'utf-8');
  return JSON.parse(raw) as T;
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/health', baseUrl));
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`app did not become healthy within ${timeoutMs}ms`);
}

async function getContainerIp(containerId: string, networkName: string): Promise<string> {
  const { stdout } = await execFileAsync('docker', [
    'inspect',
    containerId,
    '--format',
    `{{(index .NetworkSettings.Networks "${networkName}").IPAddress}}`,
  ]);
  const ip = stdout.trim();
  if (!ip) throw new Error('could not determine container IP address');
  return ip;
}

async function getContainerLogs(containerId: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('docker', ['logs', containerId]);
    return stdout + stderr;
  } catch {
    return '';
  }
}

async function runChallengePipeline(solution: 'reference' | 'broken') {
  const workspaceDir = path.join(challengeDir, 'solutions', solution);
  const { challenge } = await validateWorkspace(workspaceDir);
  const { imageTag } = await buildImage(workspaceDir, challenge.level, '');

  try {
    const run = await startRun(imageTag, challenge);
    try {
      const ip = await getContainerIp(run.appContainerId, run.networkName);
      const baseUrl = `http://${ip}:8000`;
      await waitForHealth(baseUrl, 30_000);

      const publicChecks = await readJson<FunctionalCheckDefinition[]>('checks/functional-public.json');
      const hiddenChecks = await readJson<FunctionalCheckDefinition[]>('checks/functional-hidden.json');
      const functionalResult = await runFunctionalChecks(baseUrl, publicChecks, hiddenChecks);
      const allFunctional = [...functionalResult.publicChecks, ...functionalResult.hiddenChecks];
      const functionalPassRate = allFunctional.filter((c) => c.passed).length / allFunctional.length;

      const spec = await loadOpenApiDocument(challengeDir);
      const contractRequests = await readJson<ContractCheckRequest[]>('checks/contract-requests.json');
      const robustnessProbes = await readJson<RobustnessProbe[]>('checks/robustness-probes.json');
      const contractRobustness = await runContractRobustnessChecks(baseUrl, spec, contractRequests, robustnessProbes);

      const containerLogs = await getContainerLogs(run.appContainerId);
      const { score } = await runQualityAndScore(
        baseUrl,
        containerLogs,
        {
          functional: functionalPassRate,
          contract: contractRobustness.contractPassRate,
          robustness: contractRobustness.robustnessPassRate,
        },
        challenge.rubric,
      );

      return { score, allFunctional, contractRobustness };
    } finally {
      await run.teardown();
    }
  } finally {
    await execFileAsync('docker', ['rmi', '-f', imageTag]).catch(() => {});
  }
}

test('reference solution scores 100 through the worker pipeline', { skip: !process.env.RUN_DOCKER_TESTS }, async () => {
  const { score } = await runChallengePipeline('reference');
  assert.equal(score, 100);
});

test('broken solution fails at least one check', { skip: !process.env.RUN_DOCKER_TESTS }, async () => {
  const { allFunctional, contractRobustness } = await runChallengePipeline('broken');
  const anyFailure =
    allFunctional.some((c) => !c.passed) ||
    contractRobustness.contractChecks.some((c) => !c.passed) ||
    contractRobustness.robustnessChecks.some((c) => !c.passed);
  assert.ok(anyFailure, 'expected the broken solution to fail at least one check');
});
