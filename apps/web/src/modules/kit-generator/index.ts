import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cookies } from 'next/headers';
import JSZip from 'jszip';
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import YAML from 'yaml';
import { loadEnv, validateChallengeContent, type Env } from '@forge/shared';
import { requireRole, type SessionCookieReader } from '../identity/index.js';
import {
  getDraftVersionForPreview,
  type Challenge,
  type Stack,
} from '../catalogue/index.js';

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

const REPOSITORY_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertRepositoryKey(key: string, kind: string): void {
  if (!REPOSITORY_KEY_PATTERN.test(key)) {
    throw new Error(`Kit-generator module: ${kind} "${key}" is not a valid repository key`);
  }
}

// The repository root is not knowable from a fixed number of directory hops once this
// module is bundled for a Next.js build, so walk up from the process cwd until we find
// the checked-in content directories instead of hard-coding a relative path.
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(path.join(dir, 'challenges')) && existsSync(path.join(dir, 'templates'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Kit-generator module: could not locate the repository root containing "challenges" and "templates"');
    }
    dir = parent;
  }
}

function resolveWithin(root: string, ...segments: string[]): string {
  const resolved = path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Kit-generator module: path "${segments.join('/')}" resolves outside "${root}"`);
  }
  return resolved;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function toOperationId(method: string, routePath: string): string {
  const segments = routePath.split('/').filter((segment) => segment.length > 0);
  const parts = segments.map((segment) => {
    if (segment.startsWith('{') && segment.endsWith('}')) {
      return 'By' + capitalize(segment.slice(1, -1));
    }
    return capitalize(segment);
  });
  return method.toLowerCase() + parts.join('');
}

const OPENAPI_HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

interface RawOpenApiDocument {
  paths?: Record<string, Record<string, unknown>>;
}

function deriveEndpoints(openapiYaml: string, modes: Mode[], openapiPath: string): ContractEndpoint[] {
  const document = YAML.parse(openapiYaml) as RawOpenApiDocument;
  if (!document || typeof document.paths !== 'object' || document.paths === null) {
    throw new Error(`Kit-generator module: OpenAPI document at ${openapiPath} has no "paths" object`);
  }

  const endpoints: ContractEndpoint[] = [];
  for (const [routePath, pathItem] of Object.entries(document.paths)) {
    for (const method of OPENAPI_HTTP_METHODS) {
      if (!pathItem || typeof pathItem !== 'object' || !(method in pathItem)) continue;
      endpoints.push({ method, path: routePath, operationId: toOperationId(method, routePath), modes });
    }
  }
  return endpoints;
}

const PUBLIC_CHECK_PATH = 'checks/functional-public.json';

function loadChallengeContent(contentSlug: string): { enabledModes: Mode[]; enabledStacks: string[]; version: Omit<ChallengeVersion, 'ciWorkflowYaml'> } {
  assertRepositoryKey(contentSlug, 'challenge content slug');
  const root = findRepoRoot(process.cwd());
  const challengesRoot = path.join(root, 'challenges');
  const challengeDir = resolveWithin(challengesRoot, contentSlug);

  const challengeYml = readFileSync(path.join(challengeDir, 'challenge.yml'), 'utf8');
  const content = validateChallengeContent(YAML.parse(challengeYml));
  if (content.slug !== contentSlug) {
    throw new Error(`Kit-generator module: challenge.yml slug "${content.slug}" does not match content slug "${contentSlug}"`);
  }

  const brief = readFileSync(resolveWithin(challengeDir, content.briefRef), 'utf8');
  const openapiYaml = readFileSync(resolveWithin(challengeDir, content.openapiRef), 'utf8');
  const endpoints = deriveEndpoints(openapiYaml, content.enabledModes, path.join(challengeDir, content.openapiRef));
  const publicCheckContent = readFileSync(resolveWithin(challengeDir, PUBLIC_CHECK_PATH), 'utf8');

  return {
    enabledModes: content.enabledModes,
    enabledStacks: content.enabledStacks,
    version: {
      level: content.level,
      brief,
      openapiYaml,
      challengeYml,
      endpoints,
      publicChecks: {
        [PUBLIC_CHECK_PATH]: { content: publicCheckContent, modes: content.enabledModes },
      },
    },
  };
}

interface RawStackManifest {
  dockerfile: string;
  composeSnippet: string;
  readmeFragment: string;
  routeStub: { template: string; dir: string; extension: string };
  ciWorkflow: string;
}

function validateStackManifest(input: unknown, templateKey: string): RawStackManifest {
  const manifest = input as Record<string, unknown> | null;
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Kit-generator module: template manifest for "${templateKey}" is not an object`);
  }

  for (const key of ['dockerfile', 'composeSnippet', 'readmeFragment', 'ciWorkflow'] as const) {
    if (typeof manifest[key] !== 'string' || manifest[key] === '') {
      throw new Error(`Kit-generator module: template manifest for "${templateKey}" is missing "${key}"`);
    }
  }

  const routeStub = manifest.routeStub as Record<string, unknown> | undefined;
  if (
    !routeStub || typeof routeStub !== 'object' ||
    typeof routeStub.template !== 'string' || routeStub.template === '' ||
    typeof routeStub.dir !== 'string' || routeStub.dir === '' ||
    typeof routeStub.extension !== 'string' || routeStub.extension === ''
  ) {
    throw new Error(`Kit-generator module: template manifest for "${templateKey}" has an invalid "routeStub"`);
  }

  return {
    dockerfile: manifest.dockerfile as string,
    composeSnippet: manifest.composeSnippet as string,
    readmeFragment: manifest.readmeFragment as string,
    ciWorkflow: manifest.ciWorkflow as string,
    routeStub: { template: routeStub.template, dir: routeStub.dir, extension: routeStub.extension },
  };
}

function loadStackTemplate(templateKey: string): { template: StackTemplate; ciWorkflowYaml: string } {
  assertRepositoryKey(templateKey, 'stack template key');
  const root = findRepoRoot(process.cwd());
  const templatesRoot = path.join(root, 'templates');
  const templateDir = resolveWithin(templatesRoot, templateKey);

  const manifest = validateStackManifest(YAML.parse(readFileSync(path.join(templateDir, 'starter.yml'), 'utf8')), templateKey);

  return {
    template: {
      id: templateKey,
      dockerfile: readFileSync(resolveWithin(templateDir, manifest.dockerfile), 'utf8'),
      composeSnippet: readFileSync(resolveWithin(templateDir, manifest.composeSnippet), 'utf8'),
      readmeFragment: readFileSync(resolveWithin(templateDir, manifest.readmeFragment), 'utf8'),
      routeStubTemplate: readFileSync(resolveWithin(templateDir, manifest.routeStub.template), 'utf8'),
      routeStubDir: manifest.routeStub.dir,
      routeStubExtension: manifest.routeStub.extension,
    },
    ciWorkflowYaml: readFileSync(resolveWithin(templateDir, manifest.ciWorkflow), 'utf8'),
  };
}

export function generateStarterKit(
  challenge: Pick<Challenge, 'id' | 'contentSlug'>,
  stack: Pick<Stack, 'id' | 'templateKey'>,
  mode: Mode,
): Record<string, string> {
  if (!challenge.contentSlug) {
    throw new Error(`Kit-generator module: challenge "${challenge.id}" has no content slug configured`);
  }
  if (!stack.templateKey) {
    throw new Error(`Kit-generator module: stack "${stack.id}" has no template key configured`);
  }

  const { enabledModes, enabledStacks, version: baseVersion } = loadChallengeContent(challenge.contentSlug);
  if (!enabledModes.includes(mode)) {
    throw new Error(`Kit-generator module: mode "${mode}" is not enabled by challenge.yml for "${challenge.contentSlug}"`);
  }
  if (!enabledStacks.includes(stack.templateKey)) {
    throw new Error(`Kit-generator module: stack template "${stack.templateKey}" is not enabled by challenge.yml for "${challenge.contentSlug}"`);
  }

  const { template, ciWorkflowYaml } = loadStackTemplate(stack.templateKey);
  return generateKit({ ...baseVersion, ciWorkflowYaml }, template, mode);
}

export interface StarterKitPreviewSection {
  stackId: string;
  stackLabel: string;
  mode: Mode;
  files: string[];
}

export interface StarterKitPreview {
  challengeId: string;
  challengeTitle: string;
  version: number;
  sections: StarterKitPreviewSection[];
}

function stackLabel(stack: Stack, mode: Mode): string {
  return `${stack.language} / ${stack.framework} — ${mode}`;
}

export async function previewStarterKits(
  challengeId: string,
  version: number,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<StarterKitPreview | undefined> {
  await requireRole('author', cookieStore, databaseUrl);

  const draft = await getDraftVersionForPreview(challengeId, version, databaseUrl);
  if (!draft) return undefined;

  if (!draft.challenge.contentSlug) {
    throw new Error(`Kit-generator module: challenge "${draft.challenge.id}" has no content slug configured for preview`);
  }

  const { enabledModes, enabledStacks, version: baseVersion } = loadChallengeContent(draft.challenge.contentSlug);

  const sections: StarterKitPreviewSection[] = [];
  for (const stack of draft.stacks) {
    if (!stack.templateKey) {
      throw new Error(`Kit-generator module: stack "${stack.id}" has no template key configured for preview`);
    }
    if (!enabledStacks.includes(stack.templateKey)) {
      throw new Error(`Kit-generator module: stack template "${stack.templateKey}" is not enabled by challenge.yml for "${draft.challenge.contentSlug}"`);
    }

    const { template, ciWorkflowYaml } = loadStackTemplate(stack.templateKey);
    const stackVersion: ChallengeVersion = { ...baseVersion, ciWorkflowYaml };

    for (const mode of enabledModes) {
      const files = generateKit(stackVersion, template, mode);
      sections.push({
        stackId: stack.id,
        stackLabel: stackLabel(stack, mode),
        mode,
        files: Object.keys(files).sort(),
      });
    }
  }

  return {
    challengeId: draft.challenge.id,
    challengeTitle: draft.challenge.title,
    version: draft.version.version,
    sections,
  };
}

export async function createZipArchive(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [filePath, content] of Object.entries(files)) {
    zip.file(filePath, content, { createFolders: false });
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

export interface GitHubRepositoryClient {
  createRepository(input: { enrollmentId: string; files: Record<string, string> }): Promise<string>;
}

export interface ZipStorage {
  upload(key: string, zip: Buffer): Promise<string>;
  read?(key: string): Promise<Buffer | undefined>;
}

export interface StarterKitDelivery {
  repoUrl: string | null;
  downloadUrl: string | null;
}

function starterKitKey(enrollmentId: string): string {
  return `starter-kits/${enrollmentId}.zip`;
}

async function uploadStarterKitArchive(
  enrollmentId: string,
  files: Record<string, string>,
  zipStorage: ZipStorage,
): Promise<string> {
  const zip = await createZipArchive(files);
  return zipStorage.upload(starterKitKey(enrollmentId), zip);
}

export async function deliverStarterKit(
  enrollmentId: string,
  files: Record<string, string>,
  githubClient: GitHubRepositoryClient,
  zipStorage: ZipStorage,
): Promise<StarterKitDelivery> {
  try {
    const repoUrl = await githubClient.createRepository({ enrollmentId, files });
    return { repoUrl, downloadUrl: null };
  } catch {
    const downloadUrl = await uploadStarterKitArchive(enrollmentId, files, zipStorage);
    return { repoUrl: null, downloadUrl };
  }
}

export async function readStarterKitArchive(enrollmentId: string, zipStorage: ZipStorage): Promise<Buffer | undefined> {
  if (!zipStorage.read) return undefined;
  return zipStorage.read(starterKitKey(enrollmentId));
}

export function createS3ZipStorage(env: Env): ZipStorage {
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
      return `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`;
    },

    async read(key: string): Promise<Buffer | undefined> {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
        if (!result.Body) return undefined;
        return Buffer.from(await result.Body.transformToByteArray());
      } catch (error) {
        if (error instanceof Error && (error.name === 'NoSuchKey' || error.name === 'NotFound')) return undefined;
        throw error;
      }
    },
  };
}
