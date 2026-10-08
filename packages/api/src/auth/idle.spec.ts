import { getRefreshSessionState } from './idle';

const now = Date.parse('2026-10-08T12:00:00.000Z');
const minutes = (count: number) => count * 60 * 1000;
const session = (lastActivityMinutesAgo?: number, expiresInMinutes = 60) => ({
  expiration: new Date(now + minutes(expiresInMinutes)),
  lastActivityAt:
    lastActivityMinutesAgo == null ? undefined : new Date(now - minutes(lastActivityMinutesAgo)),
});

describe('getRefreshSessionState', () => {
  const idleTimeoutMs = minutes(30);

  it('reports a missing session', () => {
    expect(getRefreshSessionState(null, { idleTimeoutMs, now })).toBe('missing');
  });

  it('expires a session at its fixed expiry, however recently it was used', () => {
    expect(getRefreshSessionState(session(1, 0), { idleTimeoutMs, now })).toBe('expired');
  });

  it('keeps a session refreshed within the idle window', () => {
    expect(getRefreshSessionState(session(29), { idleTimeoutMs, now })).toBe('active');
  });

  it('ends a session once the idle window has passed without a refresh', () => {
    expect(getRefreshSessionState(session(30), { idleTimeoutMs, now })).toBe('idle');
    expect(getRefreshSessionState(session(45), { idleTimeoutMs, now })).toBe('idle');
  });

  it('treats a session from before activity tracking as active', () => {
    expect(getRefreshSessionState(session(undefined), { idleTimeoutMs, now })).toBe('active');
  });

  it('never idles a session without a configured timeout', () => {
    expect(getRefreshSessionState(session(600), { now })).toBe('active');
    expect(getRefreshSessionState(session(600), { idleTimeoutMs: 0, now })).toBe('active');
  });
});
