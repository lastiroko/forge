import JSZip from 'jszip';
import { S3Client, PutObjectCommand, CreateBucketCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '@forge/shared';

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

// Fixed so the same file map always produces the same zip bytes; JSZip stamps each
// entry with the current time by default, which would make the archive non-deterministic.
const ZIP_ENTRY_DATE = new Date('2020-01-01T00:00:00Z');

export async function createZipArchive(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [filePath, content] of Object.entries(files)) {
    zip.file(filePath, content, { date: ZIP_ENTRY_DATE });
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

export interface GitHubRepositoryClient {
  createRepository(files: Record<string, string>): Promise<string>;
}

export interface ZipStorage {
  upload(key: string, zip: Buffer): Promise<string>;
}

export interface StarterKitDelivery {
  repoUrl: string | null;
  downloadUrl: string | null;
}

export async function deliverStarterKit(
  enrollmentId: string,
  files: Record<string, string>,
  githubClient: GitHubRepositoryClient,
  zipStorage: ZipStorage,
): Promise<StarterKitDelivery> {
  try {
    const repoUrl = await githubClient.createRepository(files);
    return { repoUrl, downloadUrl: null };
  } catch {
    const zip = await createZipArchive(files);
    const downloadUrl = await zipStorage.upload(`starter-kits/${enrollmentId}.zip`, zip);
    return { repoUrl: null, downloadUrl };
  }
}

export interface S3ZipStorageOptions {
  presignExpirySeconds?: number;
}

export function createS3ZipStorage(env: Env, options: S3ZipStorageOptions = {}): ZipStorage {
  const expiresIn = options.presignExpirySeconds ?? 3600;
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });

  return {
    async upload(key: string, zip: Buffer): Promise<string> {
      const put = new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: zip, ContentType: 'application/zip' });
      try {
        await client.send(put);
      } catch (error) {
        if (error instanceof Error && error.name === 'NoSuchBucket') {
          try {
            await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
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
      return getSignedUrl(client, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { expiresIn });
    },
  };
}
