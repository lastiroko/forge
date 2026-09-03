import type { randomBytes as nodeRandomBytes } from 'node:crypto';

const STATE_COOKIE = 'github_oauth_state';

export interface GithubAuthorizationDependencies {
  clientId: string | undefined;
  randomBytes: typeof nodeRandomBytes;
}

export function createGithubAuthorizationHandler(dependencies: GithubAuthorizationDependencies) {
  return async function GET(request: Request): Promise<Response> {
    if (!dependencies.clientId?.trim()) {
      return new Response('GitHub OAuth is not configured', { status: 500 });
    }

    const requestUrl = new URL(request.url);
    const state = dependencies.randomBytes(32).toString('base64url');
    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', dependencies.clientId);
    authorizeUrl.searchParams.set('redirect_uri', `${requestUrl.origin}/auth/github/callback`);
    authorizeUrl.searchParams.set('scope', 'read:user user:email');
    authorizeUrl.searchParams.set('state', state);

    const secure = requestUrl.protocol === 'https:' ? '; Secure' : '';
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizeUrl.toString(),
        'Set-Cookie': `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`,
      },
    });
  };
}

export { STATE_COOKIE };
