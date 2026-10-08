import { useEffect, useRef } from 'react';
import { request, getSessionKeepAliveMs } from 'librechat-data-provider';

/** Shared by every tab, so use in one keeps the others signed in. */
const LAST_ACTIVITY_KEY = 'lastActivityAt';
const LAST_KEEP_ALIVE_KEY = 'lastKeepAliveAt';
/** Survives the round trip through the identity provider's sign-out page in this tab. */
const SIGN_OUT_REASON_KEY = 'signOutReason';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
const CHECK_EVERY_MS = 15_000;
const RECORD_EVERY_MS = 5_000;

function readTime(key: string): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeTime(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /** Private mode or blocked storage: this tab still tracks its own activity. */
  }
}

/** Whether this tab is signing out for inactivity; read without clearing it. */
export function isIdleSignOutPending(): boolean {
  try {
    return sessionStorage.getItem(SIGN_OUT_REASON_KEY) === 'idle';
  } catch {
    return false;
  }
}

/** Reads and clears why the last session in this tab ended; `idle` after an idle sign-out. */
export function consumeSignOutReason(): string | null {
  try {
    const reason = sessionStorage.getItem(SIGN_OUT_REASON_KEY);
    sessionStorage.removeItem(SIGN_OUT_REASON_KEY);
    return reason;
  } catch {
    return null;
  }
}

function markIdleSignOut(): void {
  try {
    sessionStorage.setItem(SIGN_OUT_REASON_KEY, 'idle');
  } catch {
    /** The sign-in page then shows no reason. */
  }
}

/**
 * Signs the user out after `timeoutMs` (`SESSION_IDLE_TIMEOUT`) without interaction in any
 * tab. Background requests don't count: an open, unattended tab still signs out. While the
 * user is active, the session is refreshed every keep-alive interval, so the server's own
 * idle check also sees use that sends no requests, such as reading a long reply.
 */
export default function useIdleSignOut({
  timeoutMs,
  enabled,
  onIdle,
}: {
  timeoutMs?: number;
  enabled: boolean;
  onIdle: () => void;
}): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled || timeoutMs == null || !(timeoutMs > 0)) {
      return;
    }

    const keepAliveMs = getSessionKeepAliveMs(timeoutMs);
    const startedAt = Date.now();
    let lastRecorded = startedAt;
    let signedOut = false;
    writeTime(LAST_ACTIVITY_KEY, startedAt);
    writeTime(LAST_KEEP_ALIVE_KEY, Math.max(readTime(LAST_KEEP_ALIVE_KEY), startedAt));

    const keepAlive = (now: number) => {
      if (now - readTime(LAST_KEEP_ALIVE_KEY) < keepAliveMs) {
        return;
      }
      writeTime(LAST_KEEP_ALIVE_KEY, now);
      request
        .refreshToken()
        .then((response) => {
          if (response?.token) {
            request.dispatchTokenUpdatedEvent(response.token);
          }
        })
        .catch(() => {
          /** A failed refresh ends the session through the normal 401 handling. */
        });
    };

    const onActivity = () => {
      const now = Date.now();
      if (signedOut || now - lastRecorded < RECORD_EVERY_MS) {
        return;
      }
      lastRecorded = now;
      writeTime(LAST_ACTIVITY_KEY, now);
      keepAlive(now);
    };

    const check = () => {
      if (signedOut) {
        return;
      }
      const lastActivity = Math.max(readTime(LAST_ACTIVITY_KEY), lastRecorded);
      if (Date.now() - lastActivity >= timeoutMs) {
        signedOut = true;
        markIdleSignOut();
        onIdleRef.current();
      }
    };

    /** A device waking from sleep resumes timers late; check as soon as the tab is seen. */
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        check();
      }
    };

    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, onActivity));
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [enabled, timeoutMs]);
}
