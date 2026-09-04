import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import YAML from 'yaml';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';

const { challenges, challengeVersions, challengeStacks, stacks } = schema;

export type Challenge = typeof challenges.$inferSelect;
export type ChallengeVersion = typeof challengeVersions.$inferSelect;
export type Stack = typeof stacks.$inferSelect;

export type ChallengeSummary = Challenge & {
  enabledStacks: Stack[];
  basePoints: number;
  completionCount: number;
};

const CHALLENGE_BASE_POINTS: Record<string, number> = {
  junior: 100,
  mid: 300,
  senior: 700,
};

export interface ListChallengesFilters {
  level?: string;
  mode?: 'backend' | 'fullstack';
  stackId?: string;
  sort?: 'newest' | 'most-completed' | 'points';
}

export async function listChallenges(
  filters: ListChallengesFilters = {},
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<ChallengeSummary[]> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const publishedChallengeIds = db
      .selectDistinct({ challengeId: challengeVersions.challengeId })
      .from(challengeVersions)
      .where(isNotNull(challengeVersions.publishedAt));

    const conditions = [inArray(challenges.id, publishedChallengeIds)];
    if (filters.level) {
      conditions.push(eq(challenges.level, filters.level));
    }
    if (filters.mode === 'backend') {
      conditions.push(eq(challenges.backendEnabled, true));
    } else if (filters.mode === 'fullstack') {
      conditions.push(eq(challenges.fullstackEnabled, true));
    }
    if (filters.stackId) {
      conditions.push(
        inArray(
          challenges.id,
          db
            .selectDistinct({ challengeId: challengeStacks.challengeId })
            .from(challengeStacks)
            .where(eq(challengeStacks.stackId, filters.stackId)),
        ),
      );
    }

    const challengeRows = await db
      .select()
      .from(challenges)
      .where(and(...conditions));

    const challengeIds = challengeRows.map((challenge) => challenge.id);
    const stackRows = challengeIds.length
      ? await db
          .select({ challengeId: challengeStacks.challengeId, stack: stacks })
          .from(challengeStacks)
          .innerJoin(stacks, eq(challengeStacks.stackId, stacks.id))
          .where(inArray(challengeStacks.challengeId, challengeIds))
      : [];

    const stacksByChallengeId = new Map<string, Stack[]>();
    for (const row of stackRows) {
      const existing = stacksByChallengeId.get(row.challengeId) ?? [];
      existing.push(row.stack);
      stacksByChallengeId.set(row.challengeId, existing);
    }

    const summaries: ChallengeSummary[] = challengeRows.map((challenge) => ({
      ...challenge,
      enabledStacks: stacksByChallengeId.get(challenge.id) ?? [],
      basePoints: CHALLENGE_BASE_POINTS[challenge.level] ?? 0,
      // completionCount is hardcoded to 0 because no submissions/points module (E7) exists yet.
      completionCount: 0,
    }));

    const sort = filters.sort ?? 'newest';
    if (sort === 'points') {
      summaries.sort((a, b) => b.basePoints - a.basePoints);
    } else if (sort === 'most-completed') {
      summaries.sort((a, b) => b.completionCount - a.completionCount);
    } else {
      summaries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    return summaries;
  } finally {
    await pool.end();
  }
}

export async function getChallenge(
  id: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Challenge | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db.select().from(challenges).where(eq(challenges.id, id));
    return row;
  } finally {
    await pool.end();
  }
}

export async function getVersion(
  id: string,
  version: number,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<ChallengeVersion | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db
      .select()
      .from(challengeVersions)
      .where(
        and(
          eq(challengeVersions.challengeId, id),
          eq(challengeVersions.version, version),
          isNotNull(challengeVersions.publishedAt),
        ),
      );
    return row;
  } finally {
    await pool.end();
  }
}

export async function getEnabledStacks(
  challengeId: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Stack[]> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const rows = await db
      .select({ stack: stacks })
      .from(challengeStacks)
      .innerJoin(stacks, eq(challengeStacks.stackId, stacks.id))
      .where(eq(challengeStacks.challengeId, challengeId));
    return rows.map((row) => row.stack);
  } finally {
    await pool.end();
  }
}

export async function getLatestPublishedVersion(
  challengeId: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<ChallengeVersion | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db
      .select()
      .from(challengeVersions)
      .where(
        and(
          eq(challengeVersions.challengeId, challengeId),
          isNotNull(challengeVersions.publishedAt),
        ),
      )
      .orderBy(desc(challengeVersions.version))
      .limit(1);
    return row;
  } finally {
    await pool.end();
  }
}

export interface DraftVersionForPreview {
  challenge: Challenge;
  version: ChallengeVersion;
  stacks: Stack[];
}

export async function getDraftVersionForPreview(
  challengeId: string,
  version: number,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<DraftVersionForPreview | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db
      .select({ challenge: challenges, version: challengeVersions })
      .from(challengeVersions)
      .innerJoin(challenges, eq(challengeVersions.challengeId, challenges.id))
      .where(
        and(
          eq(challengeVersions.challengeId, challengeId),
          eq(challengeVersions.version, version),
          isNull(challengeVersions.publishedAt),
        ),
      );
    if (!row) return undefined;

    const stackRows = await db
      .select({ stack: stacks })
      .from(challengeStacks)
      .innerJoin(stacks, eq(challengeStacks.stackId, stacks.id))
      .where(eq(challengeStacks.challengeId, challengeId));

    return { challenge: row.challenge, version: row.version, stacks: stackRows.map((r) => r.stack) };
  } finally {
    await pool.end();
  }
}

const OPENAPI_HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

interface RawOpenApiSchema {
  type?: string;
  format?: string;
  nullable?: boolean;
  items?: RawOpenApiSchema;
  properties?: Record<string, RawOpenApiSchema>;
  required?: string[];
  $ref?: string;
}

interface RawOpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: RawOpenApiSchema;
}

interface RawOpenApiMediaType {
  schema?: RawOpenApiSchema;
}

interface RawOpenApiRequestBody {
  required?: boolean;
  description?: string;
  content?: Record<string, RawOpenApiMediaType>;
}

interface RawOpenApiResponse {
  description?: string;
  content?: Record<string, RawOpenApiMediaType>;
}

interface RawOpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: RawOpenApiParameter[];
  requestBody?: RawOpenApiRequestBody;
  responses?: Record<string, RawOpenApiResponse>;
}

interface RawOpenApiPathItem {
  parameters?: RawOpenApiParameter[];
  get?: RawOpenApiOperation;
  put?: RawOpenApiOperation;
  post?: RawOpenApiOperation;
  delete?: RawOpenApiOperation;
  options?: RawOpenApiOperation;
  head?: RawOpenApiOperation;
  patch?: RawOpenApiOperation;
  trace?: RawOpenApiOperation;
}

interface RawOpenApiDocument {
  paths?: Record<string, RawOpenApiPathItem>;
  components?: { schemas?: Record<string, RawOpenApiSchema> };
}

export interface OpenApiSchemaProperty {
  name: string;
  required: boolean;
  schema: OpenApiSchemaShape;
}

export interface OpenApiSchemaShape {
  type: string;
  format?: string;
  nullable: boolean;
  items?: OpenApiSchemaShape;
  properties?: OpenApiSchemaProperty[];
}

export interface OpenApiParameter {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  schema?: OpenApiSchemaShape;
}

export interface OpenApiMediaType {
  contentType: string;
  schema?: OpenApiSchemaShape;
}

export interface OpenApiRequestBody {
  required: boolean;
  description?: string;
  content: OpenApiMediaType[];
}

export interface OpenApiResponse {
  status: string;
  description?: string;
  content: OpenApiMediaType[];
}

export interface OpenApiOperation {
  path: string;
  method: string;
  summary?: string;
  description?: string;
  parameters: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: OpenApiResponse[];
}

export interface OpenApiContract {
  operations: OpenApiOperation[];
}

const LOCAL_SCHEMA_REF_PREFIX = '#/components/schemas/';

function toSchemaShape(
  schema: RawOpenApiSchema,
  schemas: Record<string, RawOpenApiSchema>,
  openapiRef: string,
  seenRefs: Set<string>,
): OpenApiSchemaShape {
  if (schema.$ref) {
    if (!schema.$ref.startsWith(LOCAL_SCHEMA_REF_PREFIX)) {
      throw new Error(
        `Catalogue module: OpenAPI contract at ${openapiRef} references an unsupported schema reference "${schema.$ref}"`,
      );
    }
    const name = schema.$ref.slice(LOCAL_SCHEMA_REF_PREFIX.length);
    if (seenRefs.has(name)) {
      throw new Error(`Catalogue module: OpenAPI contract at ${openapiRef} has a cyclic schema reference at "${schema.$ref}"`);
    }
    const resolved = schemas[name];
    if (!resolved) {
      throw new Error(`Catalogue module: OpenAPI contract at ${openapiRef} references unknown schema "${schema.$ref}"`);
    }
    return toSchemaShape(resolved, schemas, openapiRef, new Set([...seenRefs, name]));
  }

  if (schema.type === 'array') {
    return {
      type: 'array',
      nullable: schema.nullable ?? false,
      items: schema.items ? toSchemaShape(schema.items, schemas, openapiRef, seenRefs) : undefined,
    };
  }

  if (schema.type === 'object' || schema.properties) {
    const required = new Set(schema.required ?? []);
    const properties = Object.entries(schema.properties ?? {}).map(([name, propertySchema]) => ({
      name,
      required: required.has(name),
      schema: toSchemaShape(propertySchema, schemas, openapiRef, seenRefs),
    }));
    return { type: 'object', nullable: schema.nullable ?? false, properties };
  }

  return { type: schema.type ?? 'unknown', format: schema.format, nullable: schema.nullable ?? false };
}

function toRenderParameter(
  parameter: RawOpenApiParameter,
  schemas: Record<string, RawOpenApiSchema>,
  openapiRef: string,
): OpenApiParameter {
  return {
    name: parameter.name,
    in: parameter.in,
    required: parameter.required ?? false,
    description: parameter.description,
    schema: parameter.schema ? toSchemaShape(parameter.schema, schemas, openapiRef, new Set()) : undefined,
  };
}

function mergeParameters(
  pathParameters: RawOpenApiParameter[],
  operationParameters: RawOpenApiParameter[],
): RawOpenApiParameter[] {
  const merged = new Map<string, RawOpenApiParameter>();
  for (const parameter of pathParameters) {
    merged.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  for (const parameter of operationParameters) {
    merged.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...merged.values()];
}

function toMediaTypes(
  content: Record<string, RawOpenApiMediaType>,
  schemas: Record<string, RawOpenApiSchema>,
  openapiRef: string,
): OpenApiMediaType[] {
  return Object.entries(content).map(([contentType, mediaType]) => ({
    contentType,
    schema: mediaType.schema ? toSchemaShape(mediaType.schema, schemas, openapiRef, new Set()) : undefined,
  }));
}

function toRenderRequestBody(
  requestBody: RawOpenApiRequestBody,
  schemas: Record<string, RawOpenApiSchema>,
  openapiRef: string,
): OpenApiRequestBody {
  return {
    required: requestBody.required ?? false,
    description: requestBody.description,
    content: toMediaTypes(requestBody.content ?? {}, schemas, openapiRef),
  };
}

function toRenderResponse(
  status: string,
  response: RawOpenApiResponse,
  schemas: Record<string, RawOpenApiSchema>,
  openapiRef: string,
): OpenApiResponse {
  return {
    status,
    description: response.description,
    content: toMediaTypes(response.content ?? {}, schemas, openapiRef),
  };
}

export async function loadOpenApiContract(
  openapiRef: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenApiContract> {
  try {
    new URL(openapiRef);
  } catch {
    throw new Error(`Catalogue module: openapiRef "${openapiRef}" is not an absolute URL`);
  }

  let response: Response;
  try {
    response = await fetchImpl(openapiRef);
  } catch (error) {
    throw new Error(`Catalogue module: failed to fetch OpenAPI contract from ${openapiRef}: ${toMessage(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Catalogue module: failed to fetch OpenAPI contract from ${openapiRef} (status ${response.status})`);
  }

  const raw = await response.text();
  let document: RawOpenApiDocument;
  try {
    document = YAML.parse(raw) as RawOpenApiDocument;
  } catch (error) {
    throw new Error(`Catalogue module: OpenAPI contract at ${openapiRef} is not valid YAML: ${toMessage(error)}`);
  }

  if (!document || typeof document.paths !== 'object' || document.paths === null) {
    throw new Error(`Catalogue module: OpenAPI contract at ${openapiRef} has no "paths" object`);
  }

  const schemas = document.components?.schemas ?? {};
  const operations: OpenApiOperation[] = [];

  for (const [path, pathItem] of Object.entries(document.paths)) {
    const pathParameters = pathItem.parameters ?? [];
    for (const method of OPENAPI_HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      operations.push({
        path,
        method,
        summary: operation.summary,
        description: operation.description,
        parameters: mergeParameters(pathParameters, operation.parameters ?? []).map((parameter) =>
          toRenderParameter(parameter, schemas, openapiRef),
        ),
        requestBody: operation.requestBody ? toRenderRequestBody(operation.requestBody, schemas, openapiRef) : undefined,
        responses: Object.entries(operation.responses ?? {}).map(([status, response]) =>
          toRenderResponse(status, response, schemas, openapiRef),
        ),
      });
    }
  }

  return { operations };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
