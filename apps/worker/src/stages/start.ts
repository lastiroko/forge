import { randomUUID } from 'node:crypto';
import type { Challenge } from '../lib/challenge-schema.js';
import { createInternalNetwork, runContainer } from '../lib/docker.js';
import { createSandboxRunOptions } from '../lib/sandbox.js';
import { generateDatabaseCredentials, type DatabaseCredentials } from '../lib/credentials.js';
import { teardownRun } from './teardown.js';

export interface StartResult {
  runId: string;
  networkName: string;
  appContainerId: string;
  serviceContainerIds: string[];
  databaseCredentials: DatabaseCredentials;
  teardown: () => Promise<void>;
}

const SERVICE_IMAGES: Record<string, string> = {
  postgres: 'postgres:16-alpine',
};

export async function startRun(imageTag: string, challenge: Challenge): Promise<StartResult> {
  const runId = randomUUID();
  const networkName = `forge-run-${runId}`;
  const databaseCredentials = generateDatabaseCredentials(runId);
  const containerNames: string[] = [];
  const serviceContainerIds: string[] = [];

  const cleanup = async () => {
    await teardownRun({ networkName, containerNames });
  };

  try {
    await createInternalNetwork(networkName);

    for (const service of challenge.services) {
      const image = SERVICE_IMAGES[service];
      if (!image) {
        throw new Error(`unknown service "${service}" declared in challenge.yml`);
      }
      const name = `forge-run-${runId}-${service}`;
      const env =
        service === 'postgres'
          ? [
              `POSTGRES_USER=${databaseCredentials.username}`,
              `POSTGRES_PASSWORD=${databaseCredentials.password}`,
              `POSTGRES_DB=${databaseCredentials.database}`,
            ]
          : [];
      const containerId = await runContainer({ image, name, network: networkName, env });
      containerNames.push(name);
      serviceContainerIds.push(containerId);
    }

    const appName = `forge-run-${runId}-app`;
    const appContainerId = await runContainer({
      image: imageTag,
      name: appName,
      network: networkName,
      env: [],
      sandbox: createSandboxRunOptions(challenge.level),
    });
    containerNames.push(appName);

    return { runId, networkName, appContainerId, serviceContainerIds, databaseCredentials, teardown: cleanup };
  } catch (error) {
    await cleanup();
    throw new Error(`Start stage: ${error instanceof Error ? error.message : String(error)}`);
  }
}
