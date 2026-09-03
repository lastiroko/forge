import { SESSION_COOKIE } from '../../modules/identity/index.js';

export interface SignOutCookieStore {
  get(name: string): { value: string } | undefined;
  set(
    name: string,
    value: string,
    options: { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge: number },
  ): void;
}

export interface SignOutDependencies {
  cookieStore: SignOutCookieStore;
  deleteSession(sessionId: string): Promise<void>;
}

export function createSignOutHandler(dependencies: SignOutDependencies) {
  return async function signOut(): Promise<void> {
    const sessionId = dependencies.cookieStore.get(SESSION_COOKIE)?.value;
    if (sessionId) await dependencies.deleteSession(sessionId);

    dependencies.cookieStore.set(SESSION_COOKIE, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  };
}
