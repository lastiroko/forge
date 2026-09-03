import { randomBytes } from 'node:crypto';
import { createGithubAuthorizationHandler } from './handler.js';

export const runtime = 'nodejs';

export const GET = createGithubAuthorizationHandler({
  clientId: process.env.GITHUB_CLIENT_ID,
  randomBytes,
});
