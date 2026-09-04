import YAML from 'yaml';
import type { GitHubRepositoryClient } from '../kit-generator/index.js';

export async function validateRepositoryShape(
  repoUrl: string,
  commitSha: string,
  githubClient: GitHubRepositoryClient,
): Promise<void> {
  const dockerfileContent = await githubClient.readFile({ repoUrl, path: 'Dockerfile', commitSha });
  if (dockerfileContent === undefined) {
    throw new Error('Submissions module: repository is missing a Dockerfile at the submitted commit');
  }

  const challengeYmlContent = await githubClient.readFile({ repoUrl, path: 'challenge.yml', commitSha });
  if (challengeYmlContent === undefined) {
    throw new Error('Submissions module: repository is missing a challenge.yml at the submitted commit');
  }

  try {
    YAML.parse(challengeYmlContent);
  } catch (error) {
    throw new Error('Submissions module: challenge.yml is not valid YAML - ' + (error instanceof Error ? error.message : String(error)));
  }
}
