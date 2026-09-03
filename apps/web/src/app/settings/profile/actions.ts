'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { updateProfileForm } from './profile-update.js';

export async function updateProfileAction(formData: FormData): Promise<void> {
  const result = await updateProfileForm(formData, cookies());
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
