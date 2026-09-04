import { cookies } from 'next/headers';
import { buildAccountExport } from '../../../modules/account-export/index.js';
import { requireRole } from '../../../modules/identity/index.js';
import { createAccountExportHandler } from './handler.js';

export const runtime = 'nodejs';

export const GET = createAccountExportHandler({
  authorize: () => requireRole('member', cookies()),
  buildArchive: buildAccountExport,
});
