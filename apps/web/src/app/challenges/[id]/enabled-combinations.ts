export interface StackOption {
  id: string;
  language: string;
  framework: string;
}

export interface Combination {
  mode: 'backend' | 'fullstack';
  stack: StackOption;
}

export function getEnabledCombinations(
  challenge: { backendEnabled: boolean; fullstackEnabled: boolean },
  stacks: StackOption[],
): Combination[] {
  const modes: Combination['mode'][] = [];
  if (challenge.backendEnabled) modes.push('backend');
  if (challenge.fullstackEnabled) modes.push('fullstack');
  return modes.flatMap((mode) => stacks.map((stack) => ({ mode, stack })));
}
