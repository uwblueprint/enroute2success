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

/*
 * Calendar-day ("YYYY-MM-DD") helpers.
 *
 * Some features (e.g. announcements) are described in whole calendar days in the
 * org's timezone rather than as exact instants. These helpers convert between
 * a plain 'YYYY-MM-DD' string and the UTC instants that bound that local day.
 * 'YYYY-MM-DD' strings sort correctly as plain strings, so two calendar days can
 * be compared with `<` / `>=` without any timezone math.
 */

function splitLocalDate(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Round-trip through Date to reject impossible days such as 2026-02-31.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return [year, month, day];
}

/** True if `value` is a real calendar day written as 'YYYY-MM-DD'. */
export function isValidLocalDate(value: string): boolean {
  return splitLocalDate(value) !== null;
}

/**
 * Today's calendar day in `timeZone` as 'YYYY-MM-DD'. `now` is injectable so
 * callers (and tests) can use a single consistent instant.
 */
export function currentLocalDate(timeZone: string = ORG_TIMEZONE, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** UTC instant of 12:00 AM on the given local day. `value` must be a valid 'YYYY-MM-DD'. */
export function localDayStartUtc(value: string, timeZone: string = ORG_TIMEZONE): Date {
  const parts = splitLocalDate(value);
  if (!parts) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return zonedWallTimeToUtc(parts[0], parts[1], parts[2], timeZone);
}

/**
 * UTC instant of 11:59 PM on the given local day. Computed as "midnight at the
 * start of the next local day, minus one minute" so it stays correct on the
 * 23- and 25-hour days around daylight saving changes.
 */
export function localDayEndUtc(value: string, timeZone: string = ORG_TIMEZONE): Date {
  const parts = splitLocalDate(value);
  if (!parts) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  // `day + 1` may overflow the month; Date.UTC (used inside) normalizes that.
  const nextMidnight = zonedWallTimeToUtc(parts[0], parts[1], parts[2] + 1, timeZone);
  return new Date(nextMidnight.getTime() - 60_000);
}
