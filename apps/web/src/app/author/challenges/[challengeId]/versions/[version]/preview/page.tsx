import { notFound } from 'next/navigation';
import { isAuthorizationError } from '../../../../../../../modules/identity/index.js';
import { previewStarterKits } from '../../../../../../../modules/kit-generator/index.js';

export const dynamic = 'force-dynamic';

interface StarterKitPreviewPageProps {
  params: {
    challengeId: string;
    version: string;
  };
}

export default async function StarterKitPreviewPage({ params }: StarterKitPreviewPageProps) {
  const version = Number(params.version);
  if (!Number.isInteger(version)) notFound();

  let preview: Awaited<ReturnType<typeof previewStarterKits>>;
  try {
    preview = await previewStarterKits(params.challengeId, version);
  } catch (error) {
    if (isAuthorizationError(error)) notFound();
    throw error;
  }
  if (!preview) notFound();

  return (
    <main>
      <h1>{preview.challengeTitle}</h1>
      <p>Draft version {preview.version} — starter kit preview</p>
      {preview.sections.map((section) => (
        <section key={`${section.stackId}-${section.mode}`}>
          <h2>{section.stackLabel}</h2>
          <ul>
            {section.files.map((file) => <li key={file}>{file}</li>)}
          </ul>
        </section>
      ))}
    </main>
  );
}
