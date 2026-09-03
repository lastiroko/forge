import { getContainerLogs } from '../lib/docker.js';

export const DEFAULT_BOOT_TIMEOUT_MS = 60 * 1000;

export interface HealthWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export async function waitForHealth(
  baseUrl: string,
  appContainerId: string,
  options: HealthWaitOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      const response = await fetch(new URL('/health', baseUrl));
      if (response.status === 200) {
        return;
      }
    } catch {
      // The app may refuse connections while it is still booting.
    }

    if (Date.now() >= deadline) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const logs = await getContainerLogs(appContainerId).catch(
    (error) => 'could not capture logs: ' + (error instanceof Error ? error.message : String(error)),
  );
  throw new Error(
    'Health stage: app did not answer 200 from /health within the ' +
      Math.round(timeoutMs / 1000) +
      's timeout. Captured logs:\n' +
      logs,
  );
}
