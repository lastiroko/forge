import { isAccountExportSizeError } from '../../../modules/grading/index.js';
import {
  isAuthorizationError,
  type User,
} from '../../../modules/identity/index.js';

export interface AccountExportRouteDependencies {
  authorize: () => Promise<User>;
  buildArchive: (userId: string) => Promise<Buffer>;
  now?: () => Date;
}

export function createAccountExportHandler(dependencies: AccountExportRouteDependencies) {
  return async function GET(): Promise<Response> {
    try {
      const user = await dependencies.authorize();
      const archive = await dependencies.buildArchive(user.id);
      const date = (dependencies.now ?? (() => new Date()))().toISOString().slice(0, 10);
      return new Response(new Uint8Array(archive), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="forge-account-export-${date}.zip"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      if (isAuthorizationError(error)) return new Response('Forbidden', { status: 403 });
      if (isAccountExportSizeError(error)) return new Response('Account export is too large', { status: 413 });
      throw error;
    }
  };
}
