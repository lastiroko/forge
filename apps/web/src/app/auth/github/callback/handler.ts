import type { GitHubIdentity, Session, User } from '../../../../modules/identity/index.js';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '../../../../modules/identity/index.js';
import { STATE_COOKIE } from '../handler.js';

export interface GithubCallbackDependencies {
  clientId: string | undefined;
  clientSecret: string | undefined;
  fetch: typeof fetch;
  upsertUser(identity: GitHubIdentity): Promise<User>;
  createSession(userId: string): Promise<Session>;
}

function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

function providerFailure(): Response {
  return new Response('GitHub OAuth provider request failed', { status: 502 });
}

export function createGithubCallbackHandler(dependencies: GithubCallbackDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');
    if (!code) return new Response('Missing authorization code', { status: 400 });

    const queryState = requestUrl.searchParams.get('state');
    const storedState = cookieValue(request, STATE_COOKIE);
    if (!queryState || !storedState || queryState !== storedState) {
      return new Response('Invalid OAuth state', { status: 400 });
    }

    if (!dependencies.clientId?.trim() || !dependencies.clientSecret?.trim()) {
      return new Response('GitHub OAuth is not configured', { status: 500 });
    }

    let tokenResponse: Response;
    let identity: GitHubIdentity;
    try {
      tokenResponse = await dependencies.fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: dependencies.clientId,
          client_secret: dependencies.clientSecret,
          code,
        }),
      });
    } catch {
      return providerFailure();
    }
    if (!tokenResponse.ok) return providerFailure();

    let accessToken: string;
    try {
      const token = await tokenResponse.json() as { access_token?: unknown };
      if (typeof token.access_token !== 'string' || !token.access_token) return providerFailure();
      accessToken = token.access_token;
    } catch {
      return providerFailure();
    }

    const apiHeaders = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'Forge',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    let userResponse: Response;
    let emailsResponse: Response;
    try {
      [userResponse, emailsResponse] = await Promise.all([
        dependencies.fetch('https://api.github.com/user', { headers: apiHeaders }),
        dependencies.fetch('https://api.github.com/user/emails', { headers: apiHeaders }),
      ]);
    } catch {
      return providerFailure();
    }
    if (!userResponse.ok || !emailsResponse.ok) return providerFailure();

    try {
      const profile = await userResponse.json() as Record<string, unknown>;
      const emails = await emailsResponse.json() as unknown;
      if (
        typeof profile.id !== 'number'
        || !Number.isSafeInteger(profile.id)
        || typeof profile.login !== 'string'
        || (profile.name !== null && typeof profile.name !== 'string')
        || (profile.avatar_url !== null && typeof profile.avatar_url !== 'string')
        || !Array.isArray(emails)
      ) return providerFailure();

      const primaryEmail = emails.find((email): email is Record<string, unknown> => (
        typeof email === 'object'
        && email !== null
        && email.primary === true
        && email.verified === true
        && typeof email.email === 'string'
      ));
      if (!primaryEmail) return new Response('A verified primary email is required', { status: 400 });

      identity = {
        githubId: profile.id,
        handle: profile.login,
        displayName: profile.name ?? profile.login,
        avatarUrl: profile.avatar_url,
        email: primaryEmail.email as string,
      };
    } catch {
      return providerFailure();
    }

    const user = await dependencies.upsertUser(identity);
    const session = await dependencies.createSession(user.id);

    const headers = new Headers({ Location: new URL('/', requestUrl.origin).toString() });
    headers.append('Set-Cookie', `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${requestUrl.protocol === 'https:' ? '; Secure' : ''}`);
    headers.append('Set-Cookie', `${SESSION_COOKIE}=${session.id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`);

    return new Response(null, { status: 302, headers });
  };
}
