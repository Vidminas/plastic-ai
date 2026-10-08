import { getServerSessionIdleMs, getSessionKeepAliveMs } from '../src/session';

const MINUTE = 60 * 1000;

describe('idle sign-out timing', () => {
  it('keeps an active browser refreshing every sixth of the timeout', () => {
    expect(getSessionKeepAliveMs(30 * MINUTE)).toBe(5 * MINUTE);
  });

  it("outlasts the browser's sign-out by one keep-alive and a minute on the server", () => {
    expect(getServerSessionIdleMs(30 * MINUTE)).toBe(36 * MINUTE);
    expect(getServerSessionIdleMs(3 * MINUTE)).toBe(3.5 * MINUTE + MINUTE);
  });
});
