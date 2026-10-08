/**
 * Idle sign-out timing shared by the browser and the server for `SESSION_IDLE_TIMEOUT`.
 *
 * The browser signs out `timeoutMs` after the user's last interaction. The server only sees
 * refreshes: while the user is active the browser refreshes every keep-alive interval, so the
 * last refresh can precede the last interaction by up to that interval. The browser's sign-out
 * itself needs one more refresh (its access token has long expired), so the server keeps a
 * session for the timeout plus the keep-alive interval plus a minute of grace. The server's
 * window then only decides for a browser that stopped running, such as a closed tab.
 */

const SERVER_GRACE_MS = 60_000;

/** How often an active browser refreshes its session. */
export function getSessionKeepAliveMs(timeoutMs: number): number {
  return timeoutMs / 6;
}

/** How long the server keeps a session without a refresh before refusing to renew it. */
export function getServerSessionIdleMs(timeoutMs: number): number {
  return timeoutMs + getSessionKeepAliveMs(timeoutMs) + SERVER_GRACE_MS;
}
