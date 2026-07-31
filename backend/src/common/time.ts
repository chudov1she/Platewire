/** MLB schedule calendar (US eastern slate). Storage stays UTC. */
export const MLB_SCHEDULE_TZ = 'America/New_York';

export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function mlbScheduleDateKey(date = new Date()): string {
  return dateKeyInTimeZone(date, MLB_SCHEDULE_TZ);
}
