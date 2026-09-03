import { uploadObject, type StorageConfig } from '../lib/storage.js';

export interface ReportCheck {
  name: string;
  passed: boolean;
  message?: string;
}

export interface ReportStageInput {
  runId: string;
  score: number;
  checks: ReportCheck[];
  buildLog: string;
  appLog: string;
}

export interface ReportStageResult {
  reportUrl: string;
  buildLogUrl: string;
  appLogUrl: string;
}

export async function uploadReport(input: ReportStageInput, config: StorageConfig): Promise<ReportStageResult> {
  const report = {
    runId: input.runId,
    score: input.score,
    checks: input.checks.map((check) => ({
      name: check.name,
      passed: check.passed,
      ...(check.passed ? {} : { message: check.message ?? 'Check failed with no further detail.' }),
    })),
  };

  const reportUrl = await uploadObject(
    config,
    `reports/${input.runId}/report.json`,
    JSON.stringify(report, null, 2),
    'application/json',
  );
  const buildLogUrl = await uploadObject(config, `reports/${input.runId}/build.log`, input.buildLog, 'text/plain');
  const appLogUrl = await uploadObject(config, `reports/${input.runId}/app.log`, input.appLog, 'text/plain');

  return { reportUrl, buildLogUrl, appLogUrl };
}
