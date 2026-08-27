import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { uploadReport } from './report.js';
import type { StorageConfig } from '../lib/storage.js';

const testConfig: StorageConfig = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  accessKeyId: 'forge',
  secretAccessKey: 'forgeforge',
  bucket: 'forge-worker-test',
  forcePathStyle: true,
};

test('uploadReport produces a report with one entry per check and uploads the build/app logs', async () => {
  const runId = randomUUID();
  const score = 87.5;
  const checks = [
    { name: 'functional', passed: true },
    { name: 'contract', passed: false, message: 'contract check failed: missing field "id"' },
    { name: 'robustness', passed: false, message: 'robustness check failed: crashed on empty body' },
  ];
  const buildLog = 'Step 1/3 : FROM alpine:3.20\nbuild complete';
  const appLog = '{"level":"info","msg":"listening on 8080"}';

  const result = await uploadReport({ runId, score, checks, buildLog, appLog }, testConfig);

  const reportResponse = await fetch(result.reportUrl);
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.json();
  assert.equal(report.checks.length, checks.length);
  assert.equal(report.runId, runId);
  assert.equal(report.score, score);
  for (const check of report.checks) {
    if (check.passed === false) {
      assert.equal(typeof check.message, 'string');
      assert.ok(check.message.length > 0);
    }
  }

  const buildLogResponse = await fetch(result.buildLogUrl);
  assert.equal(buildLogResponse.status, 200);
  assert.equal(await buildLogResponse.text(), buildLog);

  const appLogResponse = await fetch(result.appLogUrl);
  assert.equal(appLogResponse.status, 200);
  assert.equal(await appLogResponse.text(), appLog);
});
