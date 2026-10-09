import { openingHoursSchema } from '../src/config';
import { isWithinOpeningHours, getSecondsUntilOpen } from '../src/hours';

const hours = openingHoursSchema.parse({ open: '06:00', close: '22:00' });

describe('opening hours', () => {
  it('defaults to UK time', () => {
    expect(hours.timezone).toBe('Europe/London');
  });

  it('opens at the open time and closes at the close time, in UK summer time', () => {
    /* BST is UTC+1 */
    expect(isWithinOpeningHours(hours, new Date('2026-07-01T04:59:59Z'))).toBe(false);
    expect(isWithinOpeningHours(hours, new Date('2026-07-01T05:00:00Z'))).toBe(true);
    expect(isWithinOpeningHours(hours, new Date('2026-07-01T20:59:59Z'))).toBe(true);
    expect(isWithinOpeningHours(hours, new Date('2026-07-01T21:00:00Z'))).toBe(false);
  });

  it('follows the clocks back to GMT in winter', () => {
    expect(isWithinOpeningHours(hours, new Date('2026-12-01T05:30:00Z'))).toBe(false);
    expect(isWithinOpeningHours(hours, new Date('2026-12-01T06:00:00Z'))).toBe(true);
    expect(isWithinOpeningHours(hours, new Date('2026-12-01T21:59:00Z'))).toBe(true);
    expect(isWithinOpeningHours(hours, new Date('2026-12-01T22:00:00Z'))).toBe(false);
  });

  it('handles a window that runs past midnight', () => {
    const night = openingHoursSchema.parse({ open: '22:00', close: '02:00', timezone: 'UTC' });
    expect(isWithinOpeningHours(night, new Date('2026-12-01T23:00:00Z'))).toBe(true);
    expect(isWithinOpeningHours(night, new Date('2026-12-01T01:59:00Z'))).toBe(true);
    expect(isWithinOpeningHours(night, new Date('2026-12-01T12:00:00Z'))).toBe(false);
  });

  it('counts the seconds until the window opens', () => {
    expect(getSecondsUntilOpen(hours, new Date('2026-12-01T22:00:00Z'))).toBe(8 * 3600);
    expect(getSecondsUntilOpen(hours, new Date('2026-12-01T05:59:30Z'))).toBe(30);
  });

  it('rejects malformed times, equal times and unknown zones', () => {
    expect(openingHoursSchema.safeParse({ open: '6:00', close: '22:00' }).success).toBe(false);
    expect(openingHoursSchema.safeParse({ open: '24:00', close: '22:00' }).success).toBe(false);
    expect(openingHoursSchema.safeParse({ open: '06:00', close: '06:00' }).success).toBe(false);
    expect(
      openingHoursSchema.safeParse({ open: '06:00', close: '22:00', timezone: 'Mars/Base' })
        .success,
    ).toBe(false);
  });
});
