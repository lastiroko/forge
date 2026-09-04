import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SandboxRunOptions } from './sandbox.js';

const execFileAsync = promisify(execFile);

export interface RunContainerOptions {
  image: string;
  name: string;
  network: string;
  env?: string[];
  sandbox?: SandboxRunOptions;
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
  if (options.sandbox) {
    const { User, HostConfig } = options.sandbox;
    if (HostConfig.Runtime !== 'runsc') {
      throw new Error('Sandbox policy must use the runsc runtime');
    }
    if (User !== '65532:65532') {
      throw new Error('Sandbox policy must run as the non-root user 65532:65532');
    }
    if (!HostConfig.ReadonlyRootfs) {
      throw new Error('Sandbox policy must enable a read-only root filesystem');
    }
    if (HostConfig.Privileged) {
      throw new Error('Sandbox policy does not permit privileged mode');
    }
    if (HostConfig.CapAdd.length > 0) {
      throw new Error('Sandbox policy does not permit adding Linux capabilities');
    }
    if (HostConfig.Binds.length > 0) {
      throw new Error('Sandbox policy does not permit host mounts');
    }
    args.push('--runtime', HostConfig.Runtime);
    args.push('--user', User);
    if (HostConfig.ReadonlyRootfs) {
      args.push('--read-only');
    }
    args.push('--privileged=false');
    args.push('--cap-drop', 'ALL');
    for (const tmpfs of HostConfig.Tmpfs) {
      args.push('--tmpfs', tmpfs);
    }
    args.push('--pids-limit', String(HostConfig.PidsLimit));
    args.push('--storage-opt', `size=${HostConfig.StorageOpt.size}`);
  }
  args.push(options.image);
  const { stdout } = await execFileAsync('docker', args);
  return stdout.trim();
}

export async function removeContainer(name: string): Promise<void> {
  await execFileAsync('docker', ['rm', '--force', name]);
}

export async function getContainerLogs(nameOrId: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync('docker', ['logs', nameOrId]);
  return stdout + stderr;
}
