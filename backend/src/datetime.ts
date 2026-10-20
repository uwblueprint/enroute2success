/**
 * Timezone-aware date-range helpers for the session calendar.
 *
 * Sessions are stored as UTC instants (`TIMESTAMP(6)` columns hold UTC). The
 * home calendar, however, groups sessions by the *organization's local* month,
 * so a session at 2026-01-31T23:30 local time must count as January even though
 * its UTC instant may already be February.
 *
 * To do that correctly across DST, we compute the UTC instant that corresponds
 * to local midnight on the first day of the target month, and the UTC instant
 * for local midnight on the first day of the following month. Querying
 * `start_datetime >= gte AND start_datetime < lt` then yields exactly the
 * sessions whose *local* start date falls in the requested month.
 */

// The organization's IANA timezone. Override via ORG_TIMEZONE if the org moves
// or operates in a different locale. Defaults to US Eastern.
export const ORG_TIMEZONE = process.env.ORG_TIMEZONE ?? 'America/New_York';

/**
 * Returns the UTC offset (in minutes) that `timeZone` has at the given UTC
 * instant. Positive means ahead of UTC, negative means behind. Uses Intl so it
 * is DST-correct without any third-party library.
 */
function offsetMinutes(instant: Date, timeZone: string): number {
  // Format the instant as wall-clock time in the target zone, then interpret
  // those wall-clock parts as if they were UTC. The difference between that and
  // the real instant is the zone's offset at that moment.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return (asUTC - instant.getTime()) / 60000;
}

/**
 * Returns the UTC `Date` corresponding to a given local wall-clock time in
 * `timeZone`. DST-correct: it resolves the offset at (approximately) the target
 * instant and refines once to handle offset transitions.
 */
export function zonedWallTimeToUtc(
  year: number,
  month1to12: number,
  day: number,
  timeZone: string = ORG_TIMEZONE
): Date {
  // First guess: treat the wall-clock as if it were UTC.
  const guessUtcMs = Date.UTC(year, month1to12 - 1, day, 0, 0, 0);
  // Offset at the guess, then correct. One refinement handles the rare case
  // where the guess and the true instant fall on opposite sides of a DST change.
  let offset = offsetMinutes(new Date(guessUtcMs), timeZone);
  let utcMs = guessUtcMs - offset * 60000;
  const refinedOffset = offsetMinutes(new Date(utcMs), timeZone);
  if (refinedOffset !== offset) {
    offset = refinedOffset;
    utcMs = guessUtcMs - offset * 60000;
  }
  return new Date(utcMs);
}

export function monthRangeUtc(
  year: number,
  month1to12: number,
  timeZone: string = ORG_TIMEZONE
): { gte: Date; lt: Date } {
  const nextMonthYear = month1to12 === 12 ? year + 1 : year;
  const nextMonth = month1to12 === 12 ? 1 : month1to12 + 1;
  return {
    gte: zonedWallTimeToUtc(year, month1to12, 1, timeZone),
    lt: zonedWallTimeToUtc(nextMonthYear, nextMonth, 1, timeZone),
  };
}

export function yearRangeUtc(
  year: number,
  timeZone: string = ORG_TIMEZONE
): { gte: Date; lt: Date } {
  return {
    gte: zonedWallTimeToUtc(year, 1, 1, timeZone),
    lt: zonedWallTimeToUtc(year + 1, 1, 1, timeZone),
  };
}

/**
 * Returns the current local month (1-12) and year in `timeZone`.
 */
export function currentLocalMonthYear(timeZone: string = ORG_TIMEZONE): {
  month: number;
  year: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { month: get('month'), year: get('year') };
}
