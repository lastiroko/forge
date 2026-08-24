import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import { challengeSchema, type Challenge } from '../lib/challenge-schema.js';

export interface ValidateResult {
  challenge: Challenge;
}

export async function validateWorkspace(workspaceDir: string): Promise<ValidateResult> {
  try {
    await access(join(workspaceDir, 'Dockerfile'));
  } catch {
    throw new Error('Validate stage: missing Dockerfile');
  }

  try {
    await access(join(workspaceDir, 'challenge.yml'));
  } catch {
    throw new Error('Validate stage: missing challenge.yml');
  }

  const raw = await readFile(join(workspaceDir, 'challenge.yml'), 'utf-8');

  let parsed;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    throw new Error('Validate stage: challenge.yml is not valid YAML: ' + toMessage(error));
  }

  const result = challengeSchema.safeParse(parsed);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error('Validate stage: challenge.yml does not match schema - ' + message);
  }

  return { challenge: result.data };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
