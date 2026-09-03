import { notFound } from 'next/navigation';
import { getCurrentUser, type User } from '../../../modules/identity/index.js';
import { renderSubmissionPage } from './render.js';

export const dynamic = 'force-dynamic';

export default async function SubmissionPage({ params }: { params: { id: string } }) {
  let user: User | undefined;
  try {
    user = await getCurrentUser();
  } catch {
    user = undefined;
  }
  if (!user) notFound();
  return renderSubmissionPage(params.id, user);
}
