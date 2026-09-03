import {
  updateCurrentUserProfile,
  type ProfileValidationErrors,
  type SessionCookieReader,
} from '../../../modules/identity/index.js';

export type ProfileUpdateFormResult =
  | { ok: true; handle: string }
  | { ok: false; errors: ProfileValidationErrors };

export async function updateProfileForm(
  formData: FormData,
  cookieStore: SessionCookieReader,
): Promise<ProfileUpdateFormResult> {
  const displayName = String(formData.get('displayName') ?? '');
  const bio = String(formData.get('bio') ?? '');
  const links = String(formData.get('links') ?? '')
    .split('\n')
    .map((link) => link.trim())
    .filter((link) => link.length > 0);

  const result = await updateCurrentUserProfile({ displayName, bio, links }, cookieStore);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, handle: result.user.handle };
}
