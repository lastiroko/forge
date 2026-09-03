'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAuthorizationError } from '../../../modules/identity/index.js';
import { updateProfileForm } from './profile-update.js';

export async function updateProfileAction(formData: FormData): Promise<void> {
  let result;
  try {
    result = await updateProfileForm(formData, cookies());
  } catch (error) {
    if (isAuthorizationError(error)) redirect('/auth/github');
    throw error;
  }
  if (!result.ok) {
    const params = new URLSearchParams();
    for (const [field, message] of Object.entries(result.errors)) {
      if (message) params.set(field, message);
    }
    redirect(`/settings/profile?${params.toString()}`);
  }

  revalidatePath(`/u/${result.handle}`);
  redirect(`/u/${result.handle}`);
}
