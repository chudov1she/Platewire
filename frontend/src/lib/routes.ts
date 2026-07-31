import { SLATE_TIME_ZONE } from "@/lib/config";

/** MLB official slate date in America/New_York */
export function slateDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SLATE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function defaultArchiveDate() {
  return shiftDate(slateDate(), -1);
}

export function gameUrl(id: string) {
  return `/game/${id}`;
}

export function archiveUrl(date: string) {
  return `/archive/${date}`;
}

export function playerUrl(mlbPlayerId: number) {
  return `/player/${mlbPlayerId}`;
}

export function officialUrl(mlbOfficialId: number) {
  return `/official/${mlbOfficialId}`;
}
