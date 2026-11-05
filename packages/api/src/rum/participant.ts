import { logger } from '@librechat/data-schemas';
import { ErrorTypes } from 'librechat-data-provider';
import type { SendOtlpSpan } from '~/safeguarding/sink';
import { getDefaultOtlpSpanSender } from '~/safeguarding/sink';
import { getSafeErrorMetadata } from '~/utils/errors';
import { normalizeString } from '~/utils/text';

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

/** A token set from the OpenID callback, or its claims. */
export type LoginTokenSet = { claims?: () => Record<string, unknown> } & Record<string, unknown>;

/** A stable code for each reason that the OpenID callback refuses a sign-in. */
function refusalReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Email domain not allowed') {
    return 'domain_not_allowed';
  }
  if (message === ErrorTypes.AUTH_FAILED) {
    return 'auth_failed';
  }
  if (message.includes('role to log in')) {
    return 'role_required';
  }
  return 'error';
}

/** The claims, as openidStrategy.js reads them. */
function claimsOf(tokenset: LoginTokenSet | undefined): Record<string, unknown> {
  try {
    return (tokenset?.claims ? tokenset.claims() : tokenset) ?? {};
  } catch {
    return {};
  }
}

/**
 * Sends a `login.refused` span when the app refuses a user that Cognito signed in.
 * The span has the Cognito ID, the email and a reason code. It never has the error text.
 */
export function recordLoginRefusal(
  tokenset: LoginTokenSet | undefined,
  error: unknown,
  send?: SendOtlpSpan,
): void {
  const sender = send ?? getDefaultOtlpSpanSender();
  if (sender == null) {
    return;
  }
  const claims = claimsOf(tokenset);
  sender({
    name: 'login.refused',
    scope: 'participant',
    attributes: {
      cognitoId: normalizeString(claims.sub),
      email: normalizeString(claims.email),
      reason: refusalReason(error),
    },
  }).catch((sendError: unknown) => {
    logger.warn('[participant] Could not send the span', getSafeErrorMetadata(sendError));
  });
}
