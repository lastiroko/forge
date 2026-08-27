import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const thisFile = path.basename(fileURLToPath(import.meta.url));

function gitGrepMatches(pattern) {
  try {
    const out = execFileSync('git', ['grep', '-n', '-I', '-i', '-E', pattern], { cwd: repoRoot, encoding: 'utf8' });
    return out
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.startsWith(`${thisFile}:`))
      // Test files are allowed to clean up their own inserted rows; only
      // production code paths must never update/delete points_ledger.
      .filter((line) => !line.slice(0, line.indexOf(':')).endsWith('.test.ts'));
  } catch (err) {
    if (err.status === 1) return [];
    throw err;
  }
}

test('no code path issues an update or delete against points_ledger', () => {
  assert.deepEqual(gitGrepMatches('\\.(update|delete)\\(pointsLedger\\)'), []);
  assert.deepEqual(gitGrepMatches('(update|delete[[:space:]]+from)[[:space:]]+"?points_ledger'), []);
});
