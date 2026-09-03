import YAML from 'yaml';

export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) {
    throw new Error('Submissions module: cannot parse GitHub owner/repo from repository URL ' + repoUrl);
  }
  return { owner: match[1], repo: match[2] };
}

async function fetchRepoFile(
  location: { owner: string; repo: string },
  path: string,
  commitSha: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const url = `https://api.github.com/repos/${location.owner}/${location.repo}/contents/${path}?ref=${commitSha}`;
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'forge-app' },
  });

  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error('Submissions module: GitHub API request for ' + path + ' failed with status ' + response.status);
  }

  const body = await response.json();
  return Buffer.from(body.content, 'base64').toString('utf-8');
}

export async function validateRepositoryShape(
  repoUrl: string | null,
  commitSha: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (repoUrl === null) {
    return;
  }

  const location = parseRepoUrl(repoUrl);

  const dockerfileContent = await fetchRepoFile(location, 'Dockerfile', commitSha, fetchImpl);
  if (dockerfileContent === undefined) {
    throw new Error('Submissions module: repository is missing a Dockerfile at the submitted commit');
  }

  const challengeYmlContent = await fetchRepoFile(location, 'challenge.yml', commitSha, fetchImpl);
  if (challengeYmlContent === undefined) {
    throw new Error('Submissions module: repository is missing a challenge.yml at the submitted commit');
  }

  try {
    YAML.parse(challengeYmlContent);
  } catch (error) {
    throw new Error('Submissions module: challenge.yml is not valid YAML - ' + (error instanceof Error ? error.message : String(error)));
  }
}
