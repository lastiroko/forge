import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

test('submission status client connects to the submission-specific event stream and renders terminal results', async () => {
  const source = await readFile(new URL('./SubmissionStatus.tsx', import.meta.url), 'utf8');
  assert.match(source, /new EventSource\(`\/submissions\/\$\{submissionId\}\/events`\)/);
  assert.match(source, /Score:/);
  assert.match(source, /View grading report/);
});
