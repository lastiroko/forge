import { removeContainer, removeNetwork } from '../lib/docker.js';

export interface TeardownInput {
  networkName?: string;
  containerNames?: string[];
}

export async function teardownRun(input: TeardownInput): Promise<void> {
  for (const name of [...(input.containerNames ?? [])].reverse()) {
    await removeContainer(name).catch(() => {});
  }
  if (input.networkName) {
    await removeNetwork(input.networkName).catch(() => {});
  }
}
