/** What a refresh request may do with the session its refresh token names. */
export type RefreshSessionState = 'active' | 'expired' | 'idle' | 'missing';

export interface RefreshableSession {
  /** Fixed at sign-in (`REFRESH_TOKEN_EXPIRY`); refreshing never moves it. */
  expiration: Date;
  /** When a refresh token was last issued; unset on sessions from before idle tracking. */
  lastActivityAt?: Date | null;
}

/**
 * Classifies a session for refresh. A session past its fixed expiry is `expired`; one with
 * no token issued within `idleTimeoutMs` (`SESSION_IDLE_TIMEOUT`) is `idle`. A session
 * issued before activity was recorded counts as active, so turning idle timeouts on does
 * not sign everyone out at once; its next refresh starts the clock.
 */
export function getRefreshSessionState(
  session: RefreshableSession | null | undefined,
  { idleTimeoutMs, now = Date.now() }: { idleTimeoutMs?: number; now?: number },
): RefreshSessionState {
  if (session == null) {
    return 'missing';
  }
  if (session.expiration.getTime() <= now) {
    return 'expired';
  }
  const lastActivity = session.lastActivityAt?.getTime();
  if (idleTimeoutMs != null && idleTimeoutMs > 0 && lastActivity != null) {
    if (now - lastActivity >= idleTimeoutMs) {
      return 'idle';
    }
  }
  return 'active';
}
