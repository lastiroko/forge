'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  deleteCurrentUserAccount,
  isAuthorizationError,
  SESSION_COOKIE,
  type SessionCookieReader,
} from '../../../modules/identity/index.js';

interface DeleteAccountCookieStore extends SessionCookieReader {
  set(
    name: string,
    value: string,
    options: { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge: number },
  ): void;
}

const CONFIRM_DELETION_FIELD = 'confirmDeletion';

type DeleteAccountResult =
  | { ok: true }
  | { ok: false; error: 'confirmation_required' };

// A single exported function serves both as the DangerZone form's server action (called by
// React with only `formData`, so the cookie store and database url fall back to their
// request-scoped defaults) and as a directly-testable unit (callers can override both).
export async function deleteAccountAction(
  formData: FormData,
  cookieStore: DeleteAccountCookieStore = cookies(),
  databaseUrl?: string,
): Promise<DeleteAccountResult | void> {
  if (!formData.has(CONFIRM_DELETION_FIELD)) return { ok: false, error: 'confirmation_required' };

  try {
    await deleteCurrentUserAccount(cookieStore, databaseUrl);
  } catch (error) {
    if (isAuthorizationError(error)) redirect('/auth/github');
    throw error;
  }

  cookieStore.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  redirect('/');
}

export async function submitDeleteAccountAction(formData: FormData): Promise<void> {
  await deleteAccountAction(formData);
}
