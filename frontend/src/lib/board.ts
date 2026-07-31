import type { NestGame } from "@/types/nest";

export type Stage = "future" | "live" | "final";

export function deriveStage(game: NestGame, nowMs = Date.now()): Stage {
  if (game.status === "LIVE") return "live";
  if (game.status === "FINAL") return "final";
  const start = new Date(game.game_date_utc).getTime();
  if (Number.isFinite(start) && start <= nowMs) return "live";
  return "future";
}

export function teamLabel(team: NestGame["home_team"]): string {
  return team?.abbreviation || team?.name || "TBD";
}

export function isDisplayableGame(game: NestGame): boolean {
  const away = teamLabel(game.away_team);
  const home = teamLabel(game.home_team);
  if (!away || !home) return false;
  if (away.toUpperCase() === "TBD" || home.toUpperCase() === "TBD") return false;
  return true;
}

export function groupGamesByStage(games: NestGame[], nowMs = Date.now()) {
  const live: NestGame[] = [];
  const upcoming: NestGame[] = [];
  const final: NestGame[] = [];
  for (const game of games) {
    const stage = deriveStage(game, nowMs);
    if (stage === "live") live.push(game);
    else if (stage === "final") final.push(game);
    else upcoming.push(game);
  }
  return { live, upcoming, final };
}
