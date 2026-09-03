import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildImage } from './stages/build.js';
import { startRun } from './stages/start.js';
import { validateWorkspace } from './stages/validate.js';
import { runFunctionalChecks } from './stages/functional.js';
import {
  loadOpenApiDocument,
  runContractRobustnessChecks,
  type ContractCheckRequest,
  type RobustnessProbe,
} from './stages/contract-robustness.js';
import { runQualityAndScore } from './stages/quality-and-score.js';
import type { FunctionalCheckDefinition } from './lib/check-runner.js';

const execFileAsync = promisify(execFile);

export interface PublishingCheck {
  name: string;
  passed: boolean;
  message?: string;
}

export interface SolutionEvaluation {
  score: number;
  checks: PublishingCheck[];
}

export type SolutionName = 'reference' | 'broken';
export type SolutionEvaluator = (challengeDir: string, solution: SolutionName) => Promise<SolutionEvaluation>;

export interface PublishingDatabase {
  publishDraftVersion(versionId: string): Promise<boolean>;
}

export interface PublishingDependencies {
  evaluate?: SolutionEvaluator;
  database: PublishingDatabase;
}

export interface PublishingResult {
  reference: SolutionEvaluation;
  broken: SolutionEvaluation;
  publishedAt: Date;
}

export class PublishingGateError extends Error {
  constructor(
    public readonly gate: string,
    message: string,
    public readonly evaluation?: SolutionEvaluation,
  ) {
    super(`${gate}: ${message}`);
    this.name = 'PublishingGateError';
  }
}

async function readJson<T>(challengeDir: string, relativePath: string): Promise<T> {
  const raw = await readFile(path.join(challengeDir, relativePath), 'utf-8');
  return JSON.parse(raw) as T;
}

async function waitForHealth(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/health', baseUrl));
      if (response.ok) return;
    } catch {
      // The application may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Publishing evaluator: app did not become healthy within ${timeoutMs}ms`);
}

async function getContainerIp(containerId: string, networkName: string): Promise<string> {
  const { stdout } = await execFileAsync('docker', [
    'inspect',
    containerId,
    '--format',
    `{{(index .NetworkSettings.Networks "${networkName}").IPAddress}}`,
  ]);
  const ip = stdout.trim();
  if (!ip) throw new Error('Publishing evaluator: could not determine container IP address');
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

function passRate(checks: PublishingCheck[]): number {
  return checks.length === 0 ? 1 : checks.filter((check) => check.passed).length / checks.length;
}

export async function evaluateChallengeSolution(
  challengeDir: string,
  solution: SolutionName,
): Promise<SolutionEvaluation> {
  const workspaceDir = path.join(challengeDir, 'solutions', solution);
  const { challenge } = await validateWorkspace(workspaceDir);
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.https_proxy ?? process.env.http_proxy ?? '';
  const { imageTag } = await buildImage(workspaceDir, challenge.level, proxyUrl);

  try {
    const run = await startRun(imageTag, challenge);
    try {
      const ip = await getContainerIp(run.appContainerId, run.networkName);
      const baseUrl = `http://${ip}:8000`;
      await waitForHealth(baseUrl);

      const publicDefinitions = await readJson<FunctionalCheckDefinition[]>(challengeDir, 'checks/functional-public.json');
      const hiddenDefinitions = await readJson<FunctionalCheckDefinition[]>(challengeDir, 'checks/functional-hidden.json');
      const functional = await runFunctionalChecks(baseUrl, publicDefinitions, hiddenDefinitions);
      const functionalChecks = [...functional.publicChecks, ...functional.hiddenChecks].map((check) => ({
        name: `functional:${check.name}`,
        passed: check.passed,
        message: check.message,
      }));

      const spec = await loadOpenApiDocument(challengeDir);
      const contractRequests = await readJson<ContractCheckRequest[]>(challengeDir, 'checks/contract-requests.json');
      const robustnessProbes = await readJson<RobustnessProbe[]>(challengeDir, 'checks/robustness-probes.json');
      const contractRobustness = await runContractRobustnessChecks(
        baseUrl,
        spec,
        contractRequests,
        robustnessProbes,
      );
      const containerLogs = await getContainerLogs(run.appContainerId);
      const quality = await runQualityAndScore(
        baseUrl,
        containerLogs,
        {
          functional: passRate(functionalChecks),
          contract: contractRobustness.contractPassRate,
          robustness: contractRobustness.robustnessPassRate,
        },
        challenge.rubric,
      );
      const checks: PublishingCheck[] = [
        ...functionalChecks,
        ...contractRobustness.contractChecks,
        ...contractRobustness.robustnessChecks,
        ...quality.qualityChecks.map((check) => ({ ...check, name: `quality:${check.name}` })),
      ];
      return { score: quality.score, checks };
    } finally {
      await run.teardown();
    }
  } finally {
    await execFileAsync('docker', ['rmi', '-f', imageTag]).catch(() => {});
  }
}

export async function publishChallengeVersion(
  challengeDir: string,
  versionId: string,
  dependencies: PublishingDependencies,
): Promise<PublishingResult> {
  const evaluate = dependencies.evaluate ?? evaluateChallengeSolution;
  const reference = await evaluate(challengeDir, 'reference');
  if (reference.score !== 100) {
    throw new PublishingGateError('reference solution score', `expected 100, got ${reference.score}`, reference);
  }

  const broken = await evaluate(challengeDir, 'broken');
  const failedChecks = broken.checks.filter((check) => !check.passed).map((check) => check.name);
  if (failedChecks.length === 0) {
    const checkNames = broken.checks.map((check) => check.name).join(', ');
    throw new PublishingGateError(
      'broken solution checks',
      `expected at least one failed check; all checks passed (${checkNames})`,
      broken,
    );
  }

  const published = await dependencies.database.publishDraftVersion(versionId);
  if (!published) {
    throw new PublishingGateError('draft challenge version', `version ${versionId} is missing or already published`);
  }

  return { reference, broken, publishedAt: new Date() };
}
