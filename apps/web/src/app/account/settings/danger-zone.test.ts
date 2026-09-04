import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('the danger zone offers the account export before the delete submit control and requires confirmation', async () => {
  const source = await readFile(fileURLToPath(new URL('./DangerZone.tsx', import.meta.url)), 'utf8');

  const exportLink = source.indexOf('href="/account/export"');
  const deleteButton = source.indexOf('Delete account');
  assert.ok(exportLink >= 0);
  assert.ok(deleteButton > exportLink);

  const checkboxMatch = source.match(/<input[^>]*type="checkbox"[^>]*name="confirmDeletion"[^>]*>/);
  assert.ok(checkboxMatch, 'expected a confirmation checkbox named confirmDeletion');
  assert.match(checkboxMatch[0], /\brequired\b/);
  assert.ok(checkboxMatch.index !== undefined && checkboxMatch.index < deleteButton);
});
