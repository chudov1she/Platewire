/**
 * Games the office must never act on.
 *
 * Rehearsals (desk/scripts/rehearsal.py) build a synthetic game straight in the
 * collector to drive the whole path end to end. The stage watch picked one up as
 * a live game, it reached the production listener, and a real stake was sent for
 * a match that does not exist. Excluding it in the universe was not enough: five
 * other call sites reach office.consider directly.
 *
 * The check lives here so both the pipeline universe and the office gate agree.
 * MLB regular-season game ids are far below SYNTHETIC_PK_FROM.
 */
export const SYNTHETIC_PK_FROM = 990000;

export type ActableGame = {
  mlbGamePk: number;
  statusDetail?: string | null;
};

export function isActableGame(game: ActableGame): boolean {
  if (game.mlbGamePk >= SYNTHETIC_PK_FROM) return false;
  const detail = (game.statusDetail ?? '').toLowerCase();
  if (detail.includes('synthetic')) return false;
  return true;
}
