/**
 * Business-day arithmetic for DMCA § 512(g)(2)(C) compliance.
 *
 * The statute requires the safe-harbor putback window to be measured in
 * BUSINESS days, not calendar days, with a hard floor of 10 and ceiling
 * of 14. A holiday that falls inside a 14-calendar-day window can drop
 * the business-day count to 9 — restoring then is a statutory violation.
 *
 * Implementation notes:
 *   - "Business day" here = Mon–Fri excluding US federal holidays. The
 *     statute uses "business days" without a federal-vs-state holiday
 *     definition; using the federal calendar is the conservative reading
 *     adopted by major OSPs and reflected in standard 512 commentary.
 *   - Holidays are observed dates (e.g. New Year's Day on a Saturday is
 *     observed Friday). The list is regenerated yearly because three
 *     federal holidays (MLK Day, Presidents' Day, Memorial Day,
 *     Thanksgiving) are tied to specific weekday positions in the month.
 *   - Counts the number of business days STRICTLY AFTER `start`, up to
 *     and including `end`. So if a counter-notice is filed on Monday
 *     12:00 UTC, the business-day count rolls to 1 on Tuesday and 5 on
 *     Friday of the same week.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Return the set of US federal holiday observed dates for `year` as
 * `YYYY-MM-DD` strings. Generated rather than hard-coded so the table
 * never gets stale (and we avoid shipping a 200-row CSV).
 */
export function usFederalHolidaysObserved(year: number): Set<string> {
  const out = new Set<string>();

  // Fixed-date holidays + observed-day shift (Sat → Fri, Sun → Mon).
  const fixed: Array<[number, number]> = [
    [1, 1], // New Year's Day
    [6, 19], // Juneteenth
    [7, 4], // Independence Day
    [11, 11], // Veterans Day
    [12, 25], // Christmas Day
  ];
  for (const [m, d] of fixed) {
    out.add(observed(new Date(Date.UTC(year, m - 1, d))));
  }

  // Floating holidays.
  out.add(toIsoDate(nthWeekdayOfMonth(year, 1, 1, 3))); // MLK: 3rd Monday Jan
  out.add(toIsoDate(nthWeekdayOfMonth(year, 2, 1, 3))); // Presidents' Day: 3rd Monday Feb
  out.add(toIsoDate(lastWeekdayOfMonth(year, 5, 1))); // Memorial Day: last Monday May
  out.add(toIsoDate(nthWeekdayOfMonth(year, 9, 1, 1))); // Labor Day: 1st Monday Sep
  out.add(toIsoDate(nthWeekdayOfMonth(year, 10, 1, 2))); // Columbus Day: 2nd Monday Oct
  out.add(toIsoDate(nthWeekdayOfMonth(year, 11, 4, 4))); // Thanksgiving: 4th Thursday Nov

  // Inauguration Day is every 4 years (years divisible by 4 + 1, so 2025, 2029…)
  // observed only in DC + parts of VA/MD; non-business-day for federal workers
  // there. Counting it nationally over-protects respondents (we wait an extra
  // day) which is fine for safe harbor.
  if (year % 4 === 1) {
    out.add(observed(new Date(Date.UTC(year, 0, 20))));
  }

  return out;
}

function observed(date: Date): string {
  const day = date.getUTCDay();
  if (day === 6) {
    // Saturday → observed Friday
    return toIsoDate(new Date(date.getTime() - MS_PER_DAY));
  }
  if (day === 0) {
    // Sunday → observed Monday
    return toIsoDate(new Date(date.getTime() + MS_PER_DAY));
  }
  return toIsoDate(date);
}

function nthWeekdayOfMonth(year: number, month1: number, weekday: number, n: number): Date {
  // weekday: 0=Sun, 1=Mon … 6=Sat
  const first = new Date(Date.UTC(year, month1 - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month1 - 1, 1 + offset + (n - 1) * 7));
}

function lastWeekdayOfMonth(year: number, month1: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month1, 0)); // day 0 of next month = last of this
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(last.getTime() - offset * MS_PER_DAY);
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Count business days (Mon–Fri, excluding US federal holidays) strictly
 * AFTER `start` up to and including the calendar date of `end`. Times
 * within a day are ignored — only the date component matters. If `end`
 * is at or before `start`, returns 0.
 *
 * The legal clock for § 512(g)(2)(C) starts on receipt of the
 * counter-notice; the receipt day itself does not count toward the 10.
 */
export function businessDaysBetween(start: Date, end: Date): number {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  const startDay = atUtcMidnight(start);
  const endDay = atUtcMidnight(end);
  if (endDay.getTime() <= startDay.getTime()) return 0;

  // Cache holiday sets for the years we span (≤2 in practice).
  const years = new Set<number>();
  for (let y = startDay.getUTCFullYear(); y <= endDay.getUTCFullYear(); y++) {
    years.add(y);
  }
  const holidays = new Set<string>();
  for (const y of years) {
    for (const h of usFederalHolidaysObserved(y)) holidays.add(h);
  }

  let count = 0;
  // Walk strictly AFTER start, up to and including end.
  for (
    let cursor = new Date(startDay.getTime() + MS_PER_DAY);
    cursor.getTime() <= endDay.getTime();
    cursor = new Date(cursor.getTime() + MS_PER_DAY)
  ) {
    const dow = cursor.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (holidays.has(toIsoDate(cursor))) continue;
    count += 1;
  }
  return count;
}

function atUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
