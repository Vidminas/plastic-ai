import React from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import OpeningHoursGate from '../Resting';

const mockUseGetStartupConfig = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => mockUseGetStartupConfig(),
}));

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string, values?: Record<string, unknown>): string => {
      const template =
        (jest.requireActual('~/locales/en/translation.json') as Record<string, string>)[key] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
        values?.[name] != null ? String(values[name]) : match,
      );
    },
}));

const openingHours = {
  open: '06:00',
  close: '22:00',
  timezone: 'Europe/London',
  support: [
    {
      name: 'Childline',
      description: 'Free, private and confidential, for anyone under 19.',
      phone: '0800 1111',
      url: 'https://www.childline.org.uk',
    },
  ],
};

function mockConfig(now: string, serverNow = now) {
  mockUseGetStartupConfig.mockReturnValue({
    data: {
      appTitle: 'Plastic AI',
      openingHours: { ...openingHours, serverTime: new Date(serverNow).getTime() },
    },
    dataUpdatedAt: new Date(now).getTime(),
  });
}

let queryClient: QueryClient;

const renderGate = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <OpeningHoursGate>
        <div data-testid="app" />
      </OpeningHoursGate>
    </QueryClientProvider>,
  );

describe('OpeningHoursGate', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    queryClient.clear();
    jest.useRealTimers();
  });

  it('shows the app when no opening hours are configured', () => {
    mockUseGetStartupConfig.mockReturnValue({ data: {}, dataUpdatedAt: 0 });
    renderGate();
    expect(screen.getByTestId('app')).toBeInTheDocument();
  });

  it('shows the app inside opening hours', () => {
    jest.useFakeTimers({ now: new Date('2026-12-01T12:00:00Z') });
    mockConfig('2026-12-01T12:00:00Z');
    renderGate();
    expect(screen.getByTestId('app')).toBeInTheDocument();
  });

  it('shows the resting page with support services outside opening hours', () => {
    jest.useFakeTimers({ now: new Date('2026-12-01T23:00:00Z') });
    mockConfig('2026-12-01T23:00:00Z');
    renderGate();

    expect(screen.queryByTestId('app')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Plastic AI is resting' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/every day from 06:00 to 22:00/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call 0800 1111' })).toHaveAttribute(
      'href',
      'tel:08001111',
    );
    expect(screen.getByRole('link', { name: 'Visit the Childline website' })).toHaveAttribute(
      'href',
      'https://www.childline.org.uk',
    );
  });

  it('closes an open tab once closing time passes', () => {
    jest.useFakeTimers({ now: new Date('2026-12-01T21:59:50Z') });
    mockConfig('2026-12-01T21:59:50Z');
    renderGate();
    expect(screen.getByTestId('app')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(screen.queryByTestId('app')).not.toBeInTheDocument();
  });

  it('goes by the server clock when the device clock is wrong', () => {
    /* The device thinks it is midday; the server says 23:00. */
    jest.useFakeTimers({ now: new Date('2026-12-01T12:00:00Z') });
    mockConfig('2026-12-01T12:00:00Z', '2026-12-01T23:00:00Z');
    renderGate();
    expect(screen.queryByTestId('app')).not.toBeInTheDocument();
  });

  it('shows the resting page after a failed sign-in removes the config query mid-fetch', async () => {
    jest.useFakeTimers({ now: new Date('2026-12-01T23:00:00Z'), doNotFake: ['nextTick'] });
    const key = [QueryKeys.startupConfig, false, 'default'];
    const config = {
      appTitle: 'Plastic AI',
      openingHours: { ...openingHours, serverTime: new Date('2026-12-01T23:00:00Z').getTime() },
    };
    /* The gate's first fetch never settles: the query it belongs to is removed under it. */
    mockUseGetStartupConfig.mockImplementation(() =>
      useQuery(key, () => new Promise(() => undefined), { staleTime: Infinity }),
    );
    renderGate();
    expect(screen.getByTestId('app')).toBeInTheDocument();

    /* What the auth mutations do on a failed refresh, then the app's own refetch. */
    await act(async () => {
      queryClient.removeQueries();
      await queryClient.fetchQuery(key, () => Promise.resolve(config));
    });
    /* React Query batches its notifications on a timer, and the rebind re-renders after it. */
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        jest.advanceTimersByTime(0);
      });
    }

    expect(screen.queryByTestId('app')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Plastic AI is resting' }),
    ).toBeInTheDocument();
  });
});
