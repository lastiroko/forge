import { loadEnv } from '@forge/shared';
import { createS3ZipStorage, readStarterKitArchive } from '../../../modules/kit-generator/index.js';
import { getCurrentUser } from '../../../modules/identity/index.js';
import { getEnrollment } from '../../../modules/enrollment/index.js';
import { createGetHandler } from './handler.js';

export const runtime = 'nodejs';

export const GET = createGetHandler({
  currentUser: getCurrentUser,
  getEnrollment,
  readArchive: (enrollmentId) => readStarterKitArchive(enrollmentId, createS3ZipStorage(loadEnv())),
});
