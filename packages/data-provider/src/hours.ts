import type { TOpeningHours } from './config';

const MINUTES_PER_DAY = 24 * 60;

/** One formatter per time zone; building them is the costly part of reading the clock. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Minutes past midnight on the wall clock of `timeZone` at `now`. */
function getMinuteOfDay(timeZone: string, now: Date): number {
  let hour = 0;
  let minute = 0;
  for (const part of getFormatter(timeZone).formatToParts(now)) {
    if (part.type === 'hour') {
      hour = Number(part.value);
    } else if (part.type === 'minute') {
      minute = Number(part.value);
    }
  }
  return hour * 60 + minute;
}

function toMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * Whether `now` falls inside `openingHours`: from `open` up to, not including, `close`.
 * The browser and the server both decide with this, so they agree on the boundary.
 */
export function isWithinOpeningHours(hours: TOpeningHours, now: Date = new Date()): boolean {
  const minute = getMinuteOfDay(hours.timezone, now);
  const open = toMinutes(hours.open);
  const close = toMinutes(hours.close);
  if (open < close) {
    return minute >= open && minute < close;
  }
  return minute >= open || minute < close;
}

/**
 * Seconds until the window next opens, by the wall clock, for `Retry-After`. A daylight
 * saving change before then makes it an hour out; the browser re-checks the clock itself.
 */
export function getSecondsUntilOpen(hours: TOpeningHours, now: Date = new Date()): number {
  const minutes =
    (toMinutes(hours.open) - getMinuteOfDay(hours.timezone, now) + MINUTES_PER_DAY) %
    MINUTES_PER_DAY;
  return Math.max(0, minutes * 60 - now.getUTCSeconds());
}
