import { request } from 'librechat-data-provider';
import { act, renderHook } from '@testing-library/react';
import useIdleSignOut, { consumeSignOutReason } from '../useIdleSignOut';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    request: {
      ...actual.request,
      refreshToken: jest.fn(),
      dispatchTokenUpdatedEvent: jest.fn(),
    },
  };
});

const MINUTE = 60 * 1000;
const timeoutMs = 30 * MINUTE;
const refreshToken = request.refreshToken as jest.Mock;
const dispatchTokenUpdatedEvent = request.dispatchTokenUpdatedEvent as jest.Mock;

const interact = () => act(() => void window.dispatchEvent(new Event('pointerdown')));
const wait = (ms: number) => act(() => void jest.advanceTimersByTime(ms));

describe('useIdleSignOut', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    refreshToken.mockReset().mockResolvedValue({ token: 'fresh-token' });
    dispatchTokenUpdatedEvent.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('signs out after the timeout without interaction and records why', () => {
    const onIdle = jest.fn();
    renderHook(() => useIdleSignOut({ timeoutMs, enabled: true, onIdle }));

    wait(29 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();

    wait(MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(consumeSignOutReason()).toBe('idle');
    expect(consumeSignOutReason()).toBeNull();

    wait(10 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('stays signed in while the user interacts', () => {
    const onIdle = jest.fn();
    renderHook(() => useIdleSignOut({ timeoutMs, enabled: true, onIdle }));

    for (let elapsed = 0; elapsed < 90; elapsed += 20) {
      wait(20 * MINUTE);
      interact();
    }
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('counts interaction in another tab', () => {
    const onIdle = jest.fn();
    renderHook(() => useIdleSignOut({ timeoutMs, enabled: true, onIdle }));

    wait(25 * MINUTE);
    localStorage.setItem('lastActivityAt', String(Date.now()));
    wait(10 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('refreshes the session while active, at most every third of the timeout', async () => {
    renderHook(() => useIdleSignOut({ timeoutMs, enabled: true, onIdle: jest.fn() }));

    wait(5 * MINUTE);
    interact();
    expect(refreshToken).not.toHaveBeenCalled();

    wait(6 * MINUTE);
    interact();
    expect(refreshToken).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(dispatchTokenUpdatedEvent).toHaveBeenCalledWith('fresh-token');

    wait(MINUTE);
    interact();
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled or without a timeout', () => {
    const onIdle = jest.fn();
    renderHook(() => useIdleSignOut({ timeoutMs, enabled: false, onIdle }));
    renderHook(() => useIdleSignOut({ timeoutMs: undefined, enabled: true, onIdle }));

    wait(120 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
