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

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function runCheck(baseUrl: string, check: HttpCheck): Promise<CheckResult> {
  const url = new URL(check.request.path, baseUrl);

  let response;
  try {
    response = await fetch(url, {
      method: check.request.method,
      headers: check.request.headers,
      body: check.request.body !== undefined ? JSON.stringify(check.request.body) : undefined,
    });
  } catch {
    return { name: check.name, passed: false, message: check.failureMessage, request: check.request };
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const text = await response.text();
  const body = text.length > 0 ? tryParseJson(text) : text;

  const summary: HttpCheckResponse = { status: response.status, headers, body };

  let passed: boolean;
  try {
    passed = check.expect(summary);
  } catch {
    passed = false;
  }

  return {
    name: check.name,
    passed,
    message: passed ? undefined : check.failureMessage,
    request: check.request,
    response: summary,
  };
}

export async function runCheckSuite(baseUrl: string, checks: HttpCheck[]): Promise<CheckResult[]> {
  return Promise.all(checks.map((check) => runCheck(baseUrl, check)));
}
