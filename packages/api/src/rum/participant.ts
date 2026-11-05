import { logger } from '@librechat/data-schemas';
import type { SendOtlpSpan } from '~/safeguarding/sink';
import { getDefaultOtlpSpanSender } from '~/safeguarding/sink';
import { getSafeErrorMetadata } from '~/utils/errors';

export interface ParticipantUser {
  id?: string;
  openidId?: string;
  email?: string;
}

/** The last identity sent for each user ID, in this process. */
const sent = new Map<string, string>();

/**
 * Sends a `participant.seen` span with the user ID, Cognito ID and email.
 * Sends one time for each user, and again when the Cognito ID or email changes.
 * The HyperDX usage timeline gets these values from the span (otel/clickhouse/analytics.sql).
 */
export function recordParticipant(user: ParticipantUser | undefined, send?: SendOtlpSpan): void {
  const userId = user?.id;
  if (!userId || (!user.openidId && !user.email)) {
    return;
  }
  const identity = `${user.openidId ?? ''}\n${user.email ?? ''}`;
  if (sent.get(userId) === identity) {
    return;
  }
  const sender = send ?? getDefaultOtlpSpanSender();
  if (sender == null) {
    return;
  }
  sent.set(userId, identity);
  sender({
    name: 'participant.seen',
    scope: 'participant',
    attributes: { userId, cognitoId: user.openidId, email: user.email },
  }).catch((error: unknown) => {
    sent.delete(userId);
    logger.warn('[participant] Could not send the span', getSafeErrorMetadata(error));
  });
}
