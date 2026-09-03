import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('settings exposes account export after preferences without a deletion action', async () => {
  const source = await readFile(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
  const preferencesEnd = source.indexOf('</form>');
  const exportLink = source.indexOf('href="/account/export"');
  assert.ok(preferencesEnd >= 0);
  assert.ok(exportLink > preferencesEnd);
  assert.match(source, />Download account data</);
  assert.match(source, / download>/);
  assert.doesNotMatch(source, /delete[ -]?account|account[ -]?deletion|action=.*delete/i);
});
