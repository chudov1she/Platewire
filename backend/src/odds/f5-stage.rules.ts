import type { F5OddsStage } from './f5-scope.js';

export type StageWriteDecision =
  | { action: 'write'; lockAfter: boolean; lockPrematch: boolean }
  | { action: 'skip'; reason: string };

export function decideF5StageWrite(opts: {
  stage: F5OddsStage;
  existingLocked: boolean;
  extractOk: boolean;
  force: boolean;
  gameStatus: string;
  completedInnings: number;
}): StageWriteDecision {
  const { stage, existingLocked, extractOk, force, gameStatus, completedInnings } =
    opts;

  if (existingLocked && !force) {
    return { action: 'skip', reason: 'stage_locked' };
  }

  if (!extractOk && !force) {
    return { action: 'skip', reason: 'extract_incomplete' };
  }

  if (stage === 'prematch') {
    // First successful prematch IS the bet — lock immediately.
    return {
      action: 'write',
      lockAfter: true,
      lockPrematch: false,
    };
  }

  // inn1 / inn2: lock immediately on successful write
  return {
    action: 'write',
    lockAfter: true,
    lockPrematch: true,
  };
}
