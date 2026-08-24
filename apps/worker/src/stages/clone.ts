import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export interface CloneResult {
  workspaceDir: string;
}

export async function cloneAtSha(repoUrl: string, sha: string): Promise<CloneResult> {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'forge-clone-'));

  try {
    await execFileAsync('git', ['clone', '--quiet', repoUrl, workspaceDir]);
  } catch (error) {
    await rm(workspaceDir, { recursive: true, force: true });
    throw new Error(`Clone stage: could not clone ${repoUrl}: ${toMessage(error)}`);
  }

  try {
    await execFileAsync('git', ['checkout', '--quiet', sha], { cwd: workspaceDir });
  } catch {
    await rm(workspaceDir, { recursive: true, force: true });
    throw new Error(`Clone stage: commit ${sha} was not found in ${repoUrl}`);
  }

  return { workspaceDir };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
