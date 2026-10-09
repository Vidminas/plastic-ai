import { ErrorTypes, isWithinOpeningHours, getSecondsUntilOpen } from 'librechat-data-provider';
import type { TOpeningHours } from 'librechat-data-provider';
import type { RequestHandler } from 'express';

/**
 * Paths under `/api` that stay reachable while closed: the startup config, which carries
 * the opening hours the browser needs to show its resting page.
 */
const ALWAYS_OPEN_PATHS = new Set(['/config']);

/**
 * Refuses API requests outside `openingHours` with 503 and a `Retry-After` of when the
 * window opens. Mount on `/api` ahead of every route; with no opening hours it passes all.
 */
export function createOpeningHoursGate(
  getOpeningHours: () => TOpeningHours | undefined,
): RequestHandler {
  return (req, res, next) => {
    const hours = getOpeningHours();
    if (!hours || ALWAYS_OPEN_PATHS.has(req.path)) {
      return next();
    }
    const now = new Date();
    if (isWithinOpeningHours(hours, now)) {
      return next();
    }
    res.set('Retry-After', String(getSecondsUntilOpen(hours, now)));
    res.status(503).json({
      type: ErrorTypes.OUTSIDE_OPENING_HOURS,
      message: `Available daily from ${hours.open} to ${hours.close}.`,
    });
  };
}
