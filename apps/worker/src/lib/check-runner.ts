export interface FunctionalCheckDefinition {
  name: string;
  request: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  expect: { status: number; body?: unknown };
}

export interface CheckOutcome {
  name: string;
  passed: boolean;
  message?: string;
  request: FunctionalCheckDefinition['request'];
  response?: { status: number; body?: unknown };
}

export interface HttpCheckRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HttpCheckResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface HttpCheck {
  name: string;
  request: HttpCheckRequest;
  expect: (response: HttpCheckResponse) => boolean;
  failureMessage: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  message?: string;
  request: HttpCheckRequest;
  response?: HttpCheckResponse;
}

export async function runCheck(baseUrl: string, definition: FunctionalCheckDefinition): Promise<CheckOutcome> {
  let fetchResponse;
  try {
    fetchResponse = await fetch(new URL(definition.request.path, baseUrl), {
      method: definition.request.method,
      headers: { 'Content-Type': 'application/json', ...definition.request.headers },
      body: definition.request.body !== undefined ? JSON.stringify(definition.request.body) : undefined,
    });
  } catch (error) {
    return {
      name: definition.name,
      passed: false,
      message: 'request failed: ' + toMessage(error),
      request: definition.request,
    };
  }

  const text = await fetchResponse.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const response = { status: fetchResponse.status, body };

  if (response.status !== definition.expect.status) {
    return {
      name: definition.name,
      passed: false,
      message: `expected status ${definition.expect.status}, got ${response.status}`,
      request: definition.request,
      response,
    };
  }
  if (definition.expect.body !== undefined && JSON.stringify(body) !== JSON.stringify(definition.expect.body)) {
    return {
      name: definition.name,
      passed: false,
      message: 'response body did not match expected body',
      request: definition.request,
      response,
    };
  }
  return { name: definition.name, passed: true, request: definition.request, response };
}

export async function runChecks(
  baseUrl: string,
  definitions: FunctionalCheckDefinition[],
): Promise<CheckOutcome[]> {
  return Promise.all(definitions.map((definition) => runCheck(baseUrl, definition)));
}

async function runHttpCheck(baseUrl: string, check: HttpCheck): Promise<CheckResult> {
  let fetchResponse;
  try {
    fetchResponse = await fetch(new URL(check.request.path, baseUrl), {
      method: check.request.method,
      headers: check.request.headers,
      body: check.request.body !== undefined ? JSON.stringify(check.request.body) : undefined,
    });
  } catch {
    return { name: check.name, passed: false, message: check.failureMessage, request: check.request };
  }

  const headers: Record<string, string> = {};
  fetchResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const text = await fetchResponse.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const response = { status: fetchResponse.status, headers, body };

  let passed: boolean;
  try {
    passed = check.expect(response);
  } catch {
    passed = false;
  }
  return {
    name: check.name,
    passed,
    message: passed ? undefined : check.failureMessage,
    request: check.request,
    response,
  };
}

export async function runCheckSuite(baseUrl: string, checks: HttpCheck[]): Promise<CheckResult[]> {
  return Promise.all(checks.map((check) => runHttpCheck(baseUrl, check)));
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
