import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunContainerOptions {
  image: string;
  name: string;
  network: string;
  env?: string[];
}

export async function createInternalNetwork(name: string): Promise<void> {
  await execFileAsync('docker', ['network', 'create', '--internal', '--driver', 'bridge', name]);
}

export async function removeNetwork(name: string): Promise<void> {
  await execFileAsync('docker', ['network', 'rm', name]);
}

export async function runContainer(options: RunContainerOptions): Promise<string> {
  const args = ['run', '-d', '--network', options.network, '--name', options.name];
  for (const entry of options.env ?? []) {
    args.push('-e', entry);
  }
  args.push(options.image);
  const { stdout } = await execFileAsync('docker', args);
  return stdout.trim();
}

export async function removeContainer(name: string): Promise<void> {
  await execFileAsync('docker', ['rm', '--force', name]);
}
