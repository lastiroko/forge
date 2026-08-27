import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { uploadObject, type StorageConfig } from './storage.js';

const testConfig: StorageConfig = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  accessKeyId: 'forge',
  secretAccessKey: 'forgeforge',
  bucket: 'forge-worker-test',
  forcePathStyle: true,
};

test('uploadObject stores an object retrievable at the returned URL, auto-creating the bucket', async () => {
  const key = randomUUID();
  const body = 'hello from storage test';

  const url = await uploadObject(testConfig, key, body, 'text/plain');
  assert.equal(url, `${testConfig.endpoint}/${testConfig.bucket}/${key}`);

  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), body);
});
