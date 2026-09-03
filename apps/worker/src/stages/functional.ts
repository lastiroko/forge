import { runChecks, type FunctionalCheckDefinition, type CheckOutcome } from '../lib/check-runner.js';

export interface HiddenCheckResult {
  name: string;
  passed: boolean;
  message?: string;
}

export interface FunctionalResult {
  publicChecks: CheckOutcome[];
  hiddenChecks: HiddenCheckResult[];
}

export async function runFunctionalChecks(
  baseUrl: string,
  publicChecks: FunctionalCheckDefinition[],
  hiddenChecks: FunctionalCheckDefinition[],
): Promise<FunctionalResult> {
  const publicResults = await runChecks(baseUrl, publicChecks);
  const hiddenResultsFull = await runChecks(baseUrl, hiddenChecks);
  const hiddenResults = hiddenResultsFull.map((result) => ({
    name: result.name,
    passed: result.passed,
    message: result.message,
  }));
  return { publicChecks: publicResults, hiddenChecks: hiddenResults };
}
