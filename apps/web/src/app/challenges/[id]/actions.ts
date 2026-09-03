'use server';

import { loadEnv } from '@forge/shared';
import { createS3ZipStorage, type GitHubRepositoryClient } from '../../../modules/kit-generator/index.js';
import { getCurrentUser } from '../../../modules/identity/index.js';
import {
  attachRepositoryUrl,
  startChallenge,
  type BuildStarterFiles,
  type Enrollment,
  type StartChallengeDependencies,
  type StartChallengeResult,
} from '../../../modules/enrollment/index.js';

// TODO(#29 follow-up): no GitHub App client, installation-token lookup, or repository
// creation implementation exists yet (see FR-ENR-04). Every attempt fails here so members
// always land on the zip-download fallback below until that work lands.
const githubClient: GitHubRepositoryClient = {
  async createRepository(): Promise<string> {
    throw new Error('GitHub repository provisioning is not implemented yet.');
  },
};

// TODO(#29 follow-up): no production challenge-content loader (challenge.yml, CI workflow,
// public checks) or per-stack template loader (Dockerfile, compose snippet, route stubs)
// exists yet, so this cannot call kit-generator's generateKit() with real content. This
// placeholder keeps the zip-download fallback working end-to-end until that loader lands.
const buildStarterFiles: BuildStarterFiles = (version, stack, mode) => ({
  'README.md': `${version.brief}\n\nStack: ${stack.language} / ${stack.framework}\nMode: ${mode}\n`,
});

function startChallengeDependencies(): StartChallengeDependencies {
  return {
    githubClient,
    zipStorage: createS3ZipStorage(loadEnv()),
    buildStarterFiles,
  };
}

export async function startChallengeAction(
  userId: string,
  challengeId: string,
  mode: 'backend' | 'fullstack',
  stackId: string,
): Promise<StartChallengeResult> {
  return startChallenge(userId, challengeId, mode, stackId, startChallengeDependencies());
}

export async function attachRepositoryUrlAction(
  enrollmentId: string,
  repoUrl: string,
): Promise<Enrollment | undefined> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    user = undefined;
  }
  if (!user) return undefined;

  return attachRepositoryUrl(enrollmentId, user.id, repoUrl);
}
