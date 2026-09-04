import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('settings exposes account export after preferences and before the danger zone', async () => {
  const source = await readFile(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
  const dangerZone = await readFile(fileURLToPath(new URL('./DangerZone.tsx', import.meta.url)), 'utf8');
  const preferencesEnd = source.indexOf('</form>');
  const exportLink = source.indexOf('href="/account/export"');
  const dangerZonePlacement = source.indexOf('<DangerZone />');
  assert.ok(preferencesEnd >= 0);
  assert.ok(exportLink > preferencesEnd);
  assert.ok(dangerZonePlacement > exportLink);
  assert.match(source, />Download account data</);
  assert.match(source, / download>/);
  assert.match(dangerZone, /href="\/account\/export"/);
});
