import { S3Client, PutObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import type { Env } from '@forge/shared';

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

export function storageConfigFromEnv(env: Env): StorageConfig {
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucket: env.S3_BUCKET,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  };
}

function clientFor(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function uploadObject(
  config: StorageConfig,
  key: string,
  body: string,
  contentType: string,
): Promise<string> {
  const client = clientFor(config);
  const put = new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType });
  try {
    await client.send(put);
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchBucket') {
      try {
        await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
      } catch (createError) {
        if (
          !(
            createError instanceof Error &&
            (createError.name === 'BucketAlreadyOwnedByYou' || createError.name === 'BucketAlreadyExists')
          )
        ) {
          throw createError;
        }
      }
      await client.send(put);
    } else {
      throw error;
    }
  }
  return `${config.endpoint}/${config.bucket}/${key}`;
}
