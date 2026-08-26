import type { Challenge } from '../lib/challenge-schema.js';

export const DEFAULT_RESPONSE_TIME_LIMIT_MS = 500;

export interface QualityCheck {
  name: string;
  passed: boolean;
  message?: string;
}

export interface SuitePassRates {
  functional: number;
  contract: number;
  robustness: number;
}

export interface QualityAndScoreResult {
  qualityChecks: QualityCheck[];
  qualityPassRate: number;
  score: number;
}

export interface QualitySignalOptions {
  responseTimeLimitMs?: number;
}

async function checkResponseTime(baseUrl: string, limitMs: number): Promise<QualityCheck> {
  const start = Date.now();
  let response;
  try {
    response = await fetch(new URL('/health', baseUrl));
  } catch (error) {
    return { name: 'response-time', passed: false, message: 'could not reach /health: ' + toMessage(error) };
  }

  const elapsedMs = Date.now() - start;
  if (!response.ok) {
    return { name: 'response-time', passed: false, message: `/health returned ${response.status}` };
  }
  if (elapsedMs > limitMs) {
    return { name: 'response-time', passed: false, message: `/health took ${elapsedMs}ms, limit is ${limitMs}ms` };
  }
  return { name: 'response-time', passed: true };
}

function isJsonObject(line: string): boolean {
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function checkStructuredLogging(containerLogs: string): QualityCheck {
  const lines = containerLogs.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { name: 'structured-logging', passed: false, message: 'no log output captured' };
  }

  const structuredCount = lines.filter((line) => isJsonObject(line)).length;
  const ratio = structuredCount / lines.length;
  if (ratio < 0.5) {
    return {
      name: 'structured-logging',
      passed: false,
      message: `only ${structuredCount}/${lines.length} log lines are structured JSON`,
    };
  }
  return { name: 'structured-logging', passed: true };
}

export async function runQualitySignalChecks(
  baseUrl: string,
  containerLogs: string,
  options: QualitySignalOptions = {},
): Promise<QualityCheck[]> {
  const responseTimeLimitMs = options.responseTimeLimitMs ?? DEFAULT_RESPONSE_TIME_LIMIT_MS;
  return [await checkResponseTime(baseUrl, responseTimeLimitMs), checkStructuredLogging(containerLogs)];
}

export function computeScore(
  passRates: { functional: number; contract: number; robustness: number; quality: number },
  rubric: Challenge['rubric'],
): number {
  const totalWeight = rubric.functional + rubric.contract + rubric.robustness + rubric.quality;
  const weightedSum =
    passRates.functional * rubric.functional +
    passRates.contract * rubric.contract +
    passRates.robustness * rubric.robustness +
    passRates.quality * rubric.quality;
  return (weightedSum / totalWeight) * 100;
}

export async function runQualityAndScore(
  baseUrl: string,
  containerLogs: string,
  suiteResults: SuitePassRates,
  rubric: Challenge['rubric'],
  options: QualitySignalOptions = {},
): Promise<QualityAndScoreResult> {
  const qualityChecks = await runQualitySignalChecks(baseUrl, containerLogs, options);
  const qualityPassRate = qualityChecks.filter((c) => c.passed).length / qualityChecks.length;
  const score = computeScore({ ...suiteResults, quality: qualityPassRate }, rubric);
  return { qualityChecks, qualityPassRate, score };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
