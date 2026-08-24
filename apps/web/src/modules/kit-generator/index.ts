export type Mode = 'backend' | 'fullstack';

export interface ContractEndpoint {
  method: string;
  path: string;
  operationId: string;
  modes: Mode[];
}

export interface ChallengeVersion {
  level: 'junior' | 'mid' | 'senior';
  brief: string;
  openapiYaml: string;
  challengeYml: string;
  endpoints: ContractEndpoint[];
  publicChecks: Record<string, { content: string; modes: Mode[] }>;
  ciWorkflowYaml: string;
}

export interface StackTemplate {
  id: string;
  dockerfile: string;
  composeSnippet: string;
  readmeFragment: string;
  routeStubTemplate: string;
  routeStubDir: string;
  routeStubExtension: string;
}

export function generateKit(version: ChallengeVersion, stack: StackTemplate, mode: Mode): Record<string, string> {
  const files: Record<string, string> = {};

  files['README.md'] = version.brief + '\n\n' + stack.readmeFragment;
  files['openapi.yaml'] = version.openapiYaml;
  files['challenge.yml'] = version.challengeYml;
  files['Dockerfile'] = stack.dockerfile;
  files['docker-compose.yml'] = stack.composeSnippet;

  for (const endpoint of version.endpoints) {
    if (!endpoint.modes.includes(mode)) continue;

    const rendered = stack.routeStubTemplate
      .replaceAll('{{METHOD}}', endpoint.method)
      .replaceAll('{{PATH}}', endpoint.path)
      .replaceAll('{{OPERATION_ID}}', endpoint.operationId);

    files[`${stack.routeStubDir}/${endpoint.operationId}${stack.routeStubExtension}`] = rendered;
  }

  for (const [filePath, check] of Object.entries(version.publicChecks)) {
    if (!check.modes.includes(mode)) continue;
    files[filePath] = check.content;
  }

  files['.github/workflows/checks.yml'] = version.ciWorkflowYaml;

  return files;
}
