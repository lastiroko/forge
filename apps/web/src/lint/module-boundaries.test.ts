import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const filePath = path.resolve(cwd, 'src/app/example.ts');

test('flags an import that reaches past a module index', async () => {
  const eslint = new ESLint({ cwd });
  const [result] = await eslint.lintText(
    "import { helper } from '../../modules/identity/helper.js';\n",
    { filePath },
  );

  const violation = result.messages.find((message) => message.ruleId === 'no-restricted-imports');
  assert.ok(violation, 'expected a no-restricted-imports violation');
});

test('allows an import from a module index', async () => {
  const eslint = new ESLint({ cwd });
  const [result] = await eslint.lintText(
    "import { getCurrentUser } from '../../modules/identity/index.js';\n",
    { filePath },
  );

  const violation = result.messages.find((message) => message.ruleId === 'no-restricted-imports');
  assert.equal(violation, undefined);
});
