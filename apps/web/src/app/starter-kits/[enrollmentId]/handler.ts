import type { Enrollment } from '../../../modules/enrollment/index.js';
import type { User } from '../../../modules/identity/index.js';

export interface StarterKitRouteDependencies {
  currentUser(): Promise<User | undefined>;
  getEnrollment(id: string): Promise<Enrollment | undefined>;
  readArchive(enrollmentId: string): Promise<Buffer | undefined>;
}

export function createGetHandler(dependencies: StarterKitRouteDependencies) {
  return async function GET(_request: Request, { params }: { params: { enrollmentId: string } }): Promise<Response> {
    let user: User | undefined;
    try {
      user = await dependencies.currentUser();
    } catch {
      user = undefined;
    }
    if (!user) return new Response('Unauthorized', { status: 401 });

    const enrollment = await dependencies.getEnrollment(params.enrollmentId);
    if (!enrollment || enrollment.userId !== user.id || enrollment.status !== 'active') {
      return new Response('Not found', { status: 404 });
    }

    const archive = await dependencies.readArchive(enrollment.id);
    if (!archive) return new Response('Not found', { status: 404 });

    return new Response(new Uint8Array(archive), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="starter-kit-${enrollment.id}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  };
}
