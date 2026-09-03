import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneAtSha } from './clone.js';

const execFileAsync = promisify(execFile);

async function createBareFixture() {
  const sourceDir = await mkdtemp(join(tmpdir(), 'forge-clone-source-'));
  const bareDir = await mkdtemp(join(tmpdir(), 'forge-clone-bare-'));
  await execFileAsync('git', ['init', '--quiet', sourceDir]);
  await execFileAsync('git', ['-C', sourceDir, 'config', 'user.email', 'test@example.com']);
  await execFileAsync('git', ['-C', sourceDir, 'config', 'user.name', 'Test']);
  await execFileAsync('git', ['-C', sourceDir, 'commit', '--allow-empty', '--quiet', '-m', 'initial commit']);
  const { stdout } = await execFileAsync('git', ['-C', sourceDir, 'rev-parse', 'HEAD']);
  const sha = stdout.trim();
  await execFileAsync('git', ['clone', '--quiet', '--bare', sourceDir, bareDir]);
  return { sourceDir, bareDir, sha };
}

test('clones a local bare-repo fixture and checks out the known SHA', async (t) => {
  const { sourceDir, bareDir, sha } = await createBareFixture();
  let workspaceDir: string | undefined;
  t.after(async () => {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(bareDir, { recursive: true, force: true });
    if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  });

  const result = await cloneAtSha(bareDir, sha);
  workspaceDir = result.workspaceDir;

  const { stdout } = await execFileAsync('git', ['-C', result.workspaceDir, 'rev-parse', 'HEAD']);
  assert.equal(stdout.trim(), sha);
});

test('fails clearly when the SHA does not exist', async (t) => {
  const { sourceDir, bareDir } = await createBareFixture();
  t.after(async () => {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(bareDir, { recursive: true, force: true });
  });

  const unknownSha = '0123456789abcdef0123456789abcdef01234567';
  await assert.rejects(cloneAtSha(bareDir, unknownSha), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(unknownSha));
    return true;
  });
});
