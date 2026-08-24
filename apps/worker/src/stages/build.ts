import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { Challenge } from '../lib/challenge-schema.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_BUILD_TIMEOUT_MS = 10 * 60 * 1000;

export interface BuildOptions {
  timeoutMs?: number;
}

export interface BuildResult {
  imageTag: string;
}

const CPU_PERIOD = 100_000;

const LEVEL_LIMITS: Record<Challenge['level'], { memory: string; cpuQuota: number }> = {
  junior: { memory: '1g', cpuQuota: 100_000 },
  mid: { memory: '2g', cpuQuota: 200_000 },
  senior: { memory: '4g', cpuQuota: 200_000 },
};

export async function buildImage(
  workspaceDir: string,
  level: Challenge['level'],
  proxyUrl: string,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const imageTag = 'forge-submission-' + randomUUID();
  const limits = LEVEL_LIMITS[level];

  try {
    await execFileAsync(
      'docker',
      [
        'build',
        '--tag',
        imageTag,
        '--memory',
        limits.memory,
        '--cpu-period',
        String(CPU_PERIOD),
        '--cpu-quota',
        String(limits.cpuQuota),
        '--add-host',
        'host.docker.internal:host-gateway',
        '--build-arg',
        'HTTP_PROXY=' + proxyUrl,
        '--build-arg',
        'HTTPS_PROXY=' + proxyUrl,
        '--build-arg',
        'http_proxy=' + proxyUrl,
        '--build-arg',
        'https_proxy=' + proxyUrl,
        workspaceDir,
      ],
      { timeout: options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS },
    );
  } catch (error) {
    throw new Error('Build stage: image build failed or timed out: ' + toMessage(error));
  }

  return { imageTag };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
