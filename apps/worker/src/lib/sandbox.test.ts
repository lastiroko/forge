import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { Challenge } from './challenge-schema.js';
import { createSandboxRunOptions } from './sandbox.js';

const LEVEL_LIMITS: Record<Challenge['level'], { pidsLimit: number; diskSize: string }> = {
  junior: { pidsLimit: 128, diskSize: '1g' },
  mid: { pidsLimit: 256, diskSize: '2g' },
  senior: { pidsLimit: 512, diskSize: '4g' },
};

for (const [level, limits] of Object.entries(LEVEL_LIMITS) as [Challenge['level'], typeof LEVEL_LIMITS['junior']][]) {
  test(`createSandboxRunOptions("${level}") returns a locked-down sandbox policy`, () => {
    const options = createSandboxRunOptions(level);

    assert.equal(options.User, '65532:65532');
    assert.equal(options.HostConfig.Runtime, 'runsc');
    assert.equal(options.HostConfig.ReadonlyRootfs, true);
    assert.equal(options.HostConfig.Privileged, false);
    assert.deepEqual(options.HostConfig.CapAdd, []);
    assert.deepEqual(options.HostConfig.Binds, []);
    assert.ok(options.HostConfig.PidsLimit > 0);
    assert.equal(options.HostConfig.PidsLimit, limits.pidsLimit);
    assert.equal(options.HostConfig.StorageOpt.size, limits.diskSize);
  });
}

test('every challenge level is covered by an explicit sandbox policy', () => {
  const levels: Challenge['level'][] = ['junior', 'mid', 'senior'];
  for (const level of levels) {
    assert.doesNotThrow(() => createSandboxRunOptions(level));
  }
  assert.deepEqual(Object.keys(LEVEL_LIMITS).sort(), levels.slice().sort());
});
