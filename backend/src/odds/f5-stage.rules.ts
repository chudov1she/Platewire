import type { F5OddsStage } from './f5-scope.js';

export type StageWriteDecision =
  | { action: 'write'; lockAfter: boolean; lockPrematch: boolean }
  | { action: 'skip'; reason: string };

/**
 * A successful extract is always stored as a new snapshot.
 * `lockAfter` stays false: lines keep moving until the game is final.
 * `existingLocked` is ignored so an older row cannot freeze the stage.
 */
export function decideF5StageWrite(opts: {
  stage: F5OddsStage;
  existingLocked: boolean;
  extractOk: boolean;
  force: boolean;
  gameStatus: string;
  completedInnings: number;
}): StageWriteDecision {
  void opts.stage;
  void opts.existingLocked;
  void opts.gameStatus;
  void opts.completedInnings;

  // `force` only overrides the lock, never the extract. An empty extract stays
  // out of the snapshot table: the stage track must be the last GOOD read, and
  // a forced miss would otherwise become it.
  if (!opts.extractOk) {
    return { action: 'skip', reason: 'extract_incomplete' };
  }

  return {
    action: 'write',
    lockAfter: false,
    lockPrematch: false,
  };
}
