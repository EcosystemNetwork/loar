/**
 * Tests for the business-day arithmetic that gates the DMCA § 512(g)(2)(C)
 * auto-putback. The statute requires a floor of ≥10 business days; restoring
 * even one day too early is a statutory violation, so the math has to be
 * exact even across federal holidays.
 */
import { describe, it, expect } from 'vitest';
import { businessDaysBetween, usFederalHolidaysObserved } from '../lib/business-days';

describe('businessDaysBetween', () => {
  it('counts 5 weekdays in a holiday-free Mon→Mon span', () => {
    // 2026-04-13 (Mon) to 2026-04-20 (Mon)
    const start = new Date('2026-04-13T00:00:00Z');
    const end = new Date('2026-04-20T00:00:00Z');
    expect(businessDaysBetween(start, end)).toBe(5);
  });

  it('returns 0 for end at or before start', () => {
    const a = new Date('2026-04-13T00:00:00Z');
    expect(businessDaysBetween(a, a)).toBe(0);
    expect(businessDaysBetween(a, new Date('2026-04-12T00:00:00Z'))).toBe(0);
  });

  it('skips weekends', () => {
    // Friday → following Monday = 1 business day (Monday only; Sat/Sun skipped,
    // Friday itself is the start and not counted).
    const fri = new Date('2026-04-17T00:00:00Z');
    const mon = new Date('2026-04-20T00:00:00Z');
    expect(businessDaysBetween(fri, mon)).toBe(1);
  });

  it('skips a US federal holiday in the window', () => {
    // Memorial Day 2026 = Mon May 25. A Mon→Mon span over that week
    // contains 4 business days, not 5.
    const mon = new Date('2026-05-18T00:00:00Z');
    const nextMon = new Date('2026-05-25T00:00:00Z');
    // Counting strictly after start through end:
    //   Tue 5/19, Wed 5/20, Thu 5/21, Fri 5/22, Mon 5/25 — but 5/25 is the
    //   holiday, so 4 business days.
    expect(businessDaysBetween(mon, nextMon)).toBe(4);
  });

  it('14 calendar days can equal only 9 business days when a holiday lands inside', () => {
    // Counter-notice filed 2026-05-18 (Mon). 14 calendar days later =
    // 2026-06-01 (Mon). Memorial Day 5/25 falls inside → 9 business days.
    // This is the exact statutory-violation case the business-day check
    // was added to prevent.
    const cn = new Date('2026-05-18T12:00:00Z');
    const fourteenLater = new Date('2026-06-01T12:00:00Z');
    expect(businessDaysBetween(cn, fourteenLater)).toBe(9);
  });

  it('observed holiday falling on a Saturday rolls back to Friday', () => {
    // Christmas 2027 = Saturday → observed Fri 2027-12-24.
    const observed = usFederalHolidaysObserved(2027);
    expect(observed.has('2027-12-24')).toBe(true);
    expect(observed.has('2027-12-25')).toBe(false);
  });

  it('observed holiday falling on a Sunday rolls forward to Monday', () => {
    // New Year's Day 2028 = Saturday → observed Fri 2027-12-31. But for
    // 2023, New Year was Sunday Jan 1 → observed Mon 2023-01-02.
    const observed = usFederalHolidaysObserved(2023);
    expect(observed.has('2023-01-02')).toBe(true);
  });

  it('handles year boundaries when start/end span December → January', () => {
    // Dec 22 2026 (Tue) → Jan 5 2027 (Tue). Holidays: Christmas Fri 12/25/26
    // observed, New Year's Fri 1/1/27 observed. Total business days:
    //   12/23 W, 12/24 Th, 12/25 F (HOLIDAY), 12/28-31 (M-Th, 4),
    //   1/4 M, 1/5 T = 8.
    // Wait: 12/25/2026 is a Friday, observed on the day itself. New Year's
    // 2027 = Friday 1/1, observed same day.
    const start = new Date('2026-12-22T00:00:00Z');
    const end = new Date('2027-01-05T00:00:00Z');
    expect(businessDaysBetween(start, end)).toBe(8);
  });

  it('rejects invalid dates without throwing', () => {
    expect(businessDaysBetween(new Date('not a date'), new Date('2026-01-01'))).toBe(0);
    // @ts-expect-error — validating defensive runtime branch
    expect(businessDaysBetween(null, new Date('2026-01-01'))).toBe(0);
  });
});

describe('usFederalHolidaysObserved', () => {
  it('returns the 11 federal holidays for a non-inauguration year', () => {
    // 2026 is not divisible by 4 + 1, so no Inauguration Day.
    const holidays = usFederalHolidaysObserved(2026);
    expect(holidays.size).toBe(11);
  });

  it('includes Inauguration Day in years where (year % 4 === 1)', () => {
    // 2025-01-20 was a Monday — and also MLK Day (3rd Monday of Jan), so
    // the two collide in the Set. The 2029 inauguration falls on Sat
    // 1/20 → observed Fri 1/19, which DOESN'T collide with MLK Mon 1/15.
    const h2025 = usFederalHolidaysObserved(2025);
    expect(h2025.has('2025-01-20')).toBe(true);
    expect(h2025.size).toBe(11); // Inauguration collides with MLK

    const h2029 = usFederalHolidaysObserved(2029);
    expect(h2029.has('2029-01-19')).toBe(true); // observed Fri
    expect(h2029.has('2029-01-15')).toBe(true); // MLK Day
    expect(h2029.size).toBe(12);
  });

  it('Thanksgiving is the 4th Thursday in November', () => {
    // 2026: Thanksgiving = Thu Nov 26.
    const holidays = usFederalHolidaysObserved(2026);
    expect(holidays.has('2026-11-26')).toBe(true);
  });

  it('Memorial Day is the LAST Monday in May, not just the 4th', () => {
    // 2027 has 5 Mondays in May: 5/3, 5/10, 5/17, 5/24, 5/31.
    // Memorial Day must be 5/31, not 5/24.
    const holidays = usFederalHolidaysObserved(2027);
    expect(holidays.has('2027-05-31')).toBe(true);
    expect(holidays.has('2027-05-24')).toBe(false);
  });
});
