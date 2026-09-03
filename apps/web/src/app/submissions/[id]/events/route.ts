import { getCurrentUser } from '../../../../modules/identity/index.js';
import { createGetHandler } from './handler.js';

export const runtime = 'nodejs';

export const GET = createGetHandler({ currentUser: getCurrentUser });
