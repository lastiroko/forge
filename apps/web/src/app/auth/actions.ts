'use server';

import { cookies } from 'next/headers';
import { deleteSession } from '../../modules/identity/index.js';
import { createSignOutHandler } from './sign-out.js';

export async function signOutAction(): Promise<void> {
  const signOut = createSignOutHandler({ cookieStore: cookies(), deleteSession });
  await signOut();
}
