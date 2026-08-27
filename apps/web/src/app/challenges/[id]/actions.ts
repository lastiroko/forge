'use server';

import { startChallenge } from '../../../modules/enrollment/index.js';

export async function startChallengeAction(
  userId: string,
  challengeId: string,
  mode: 'backend' | 'fullstack',
  stackId: string,
) {
  return startChallenge(userId, challengeId, mode, stackId);
}
