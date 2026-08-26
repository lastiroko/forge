import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import { runCheckSuite, type HttpCheck, type HttpCheckResponse } from '../lib/check-runner.js';

export interface OpenApiSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
}

export interface OpenApiOperation {
  responses?: Record<string, { content?: Record<string, { schema?: OpenApiSchema }> }>;
}

export interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
}

export async function loadOpenApiDocument(workspaceDir: string): Promise<OpenApiDocument> {
  let raw: string;
  try {
    raw = await readFile(join(workspaceDir, 'openapi.yaml'), 'utf-8');
  } catch {
    throw new Error('Contract/robustness stage: missing openapi.yaml');
  }

  try {
    return YAML.parse(raw) as OpenApiDocument;
  } catch (error) {
    throw new Error('Contract/robustness stage: openapi.yaml is not valid YAML: ' + toMessage(error));
  }
}

export interface ContractCheck {
  name: string;
  passed: boolean;
  message?: string;
}

export interface ContractCheckRequest {
  name: string;
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

type ContractEvaluation =
  | { passed: false; reason: 'no-operation' }
  | { passed: false; reason: 'no-response-def' }
  | { passed: true; reason: 'no-schema' }
  | { passed: false; reason: 'missing-fields'; missingFields: string[] }
  | { passed: true; reason: 'ok' };

function evaluateContractResponse(
  spec: OpenApiDocument,
  req: ContractCheckRequest,
  response: HttpCheckResponse,
): ContractEvaluation {
  const operation = spec.paths[req.path]?.[req.method.toLowerCase()];
  if (!operation) {
    return { passed: false, reason: 'no-operation' };
  }

  const matched = operation.responses?.[String(response.status)] ?? operation.responses?.['default'];
  if (!matched) {
    return { passed: false, reason: 'no-response-def' };
  }

  const schema = matched.content?.['application/json']?.schema;
  if (!schema) {
    return { passed: true, reason: 'no-schema' };
  }

  const required = schema.required ?? [];
  const missing = required.filter(
    (field) =>
      typeof response.body !== 'object' || response.body === null || !(field in (response.body as Record<string, unknown>)),
  );
  if (missing.length > 0) {
    return { passed: false, reason: 'missing-fields', missingFields: missing };
  }
  return { passed: true, reason: 'ok' };
}

function buildContractHttpCheck(spec: OpenApiDocument, req: ContractCheckRequest): HttpCheck {
  return {
    name: `contract:${req.name}`,
    request: { method: req.method, path: req.path, headers: req.headers, body: req.body },
    expect: (response) => evaluateContractResponse(spec, req, response).passed,
    failureMessage: 'response does not conform to openapi.yaml',
  };
}

export async function checkContractConformance(
  baseUrl: string,
  spec: OpenApiDocument,
  requests: ContractCheckRequest[],
): Promise<ContractCheck[]> {
  const httpChecks = requests.map((req) => buildContractHttpCheck(spec, req));
  const results = await runCheckSuite(baseUrl, httpChecks);

  return results.map((result, index) => {
    const req = requests[index];
    if (!result.response) {
      return { name: result.name, passed: false, message: `could not reach ${req.method} ${req.path}` };
    }

    const evaluation = evaluateContractResponse(spec, req, result.response);
    switch (evaluation.reason) {
      case 'no-operation':
        return { name: result.name, passed: false, message: `no operation defined for ${req.method} ${req.path} in openapi.yaml` };
      case 'no-response-def':
        return {
          name: result.name,
          passed: false,
          message: `openapi.yaml defines no response for status ${result.response.status}`,
        };
      case 'missing-fields':
        return {
          name: result.name,
          passed: false,
          message: `response is missing required field(s): ${evaluation.missingFields.join(', ')}`,
        };
      case 'no-schema':
      case 'ok':
        return { name: result.name, passed: true };
    }
  });
}

export interface RobustnessProbe {
  name: string;
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  expectedStatuses: number[];
}

function buildRobustnessHttpCheck(probe: RobustnessProbe): HttpCheck {
  return {
    name: `robustness:${probe.name}`,
    request: { method: probe.method, path: probe.path, headers: probe.headers, body: probe.body },
    expect: (response) => probe.expectedStatuses.includes(response.status),
    failureMessage: `expected one of ${probe.expectedStatuses.join(', ')}`,
  };
}

export async function runRobustnessChecks(baseUrl: string, probes: RobustnessProbe[]): Promise<ContractCheck[]> {
  const httpChecks = probes.map(buildRobustnessHttpCheck);
  const results = await runCheckSuite(baseUrl, httpChecks);

  return results.map((result, index) => {
    const probe = probes[index];
    if (result.passed) {
      return { name: result.name, passed: true };
    }
    if (!result.response) {
      return { name: result.name, passed: false, message: `could not reach ${probe.method} ${probe.path}` };
    }
    return {
      name: result.name,
      passed: false,
      message: `${probe.method} ${probe.path} returned ${result.response.status}, expected one of ${probe.expectedStatuses.join(', ')}`,
    };
  });
}

export interface ContractRobustnessResult {
  contractChecks: ContractCheck[];
  robustnessChecks: ContractCheck[];
  contractPassRate: number;
  robustnessPassRate: number;
}

export async function runContractRobustnessChecks(
  baseUrl: string,
  spec: OpenApiDocument,
  contractRequests: ContractCheckRequest[],
  robustnessProbes: RobustnessProbe[],
): Promise<ContractRobustnessResult> {
  const contractChecks = await checkContractConformance(baseUrl, spec, contractRequests);
  const robustnessChecks = await runRobustnessChecks(baseUrl, robustnessProbes);

  const passRate = (checks: ContractCheck[]) =>
    checks.length === 0 ? 1 : checks.filter((c) => c.passed).length / checks.length;

  return {
    contractChecks,
    robustnessChecks,
    contractPassRate: passRate(contractChecks),
    robustnessPassRate: passRate(robustnessChecks),
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
