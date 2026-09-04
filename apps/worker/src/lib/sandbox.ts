import type { Challenge } from './challenge-schema.js';

export interface SandboxRunOptions {
  User: string;
  HostConfig: {
    Runtime: string;
    ReadonlyRootfs: boolean;
    Privileged: boolean;
    CapAdd: string[];
    Binds: string[];
    Tmpfs: string[];
    PidsLimit: number;
    StorageOpt: { size: string };
  };
}

const LEVEL_LIMITS: Record<Challenge['level'], { pidsLimit: number; diskSize: string }> = {
  junior: { pidsLimit: 128, diskSize: '1g' },
  mid: { pidsLimit: 256, diskSize: '2g' },
  senior: { pidsLimit: 512, diskSize: '4g' },
};

export function createSandboxRunOptions(level: Challenge['level']): SandboxRunOptions {
  const limits = LEVEL_LIMITS[level];
  return {
    User: '65532:65532',
    HostConfig: {
      Runtime: 'runsc',
      ReadonlyRootfs: true,
      Privileged: false,
      CapAdd: [],
      Binds: [],
      Tmpfs: ['/tmp:rw,noexec,nosuid,nodev'],
      PidsLimit: limits.pidsLimit,
      StorageOpt: { size: limits.diskSize },
    },
  };
}
