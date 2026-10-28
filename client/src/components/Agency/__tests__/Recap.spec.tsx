import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TAgencyRecap } from 'librechat-data-provider';
import AgencyRecap from '../Recap';

const mockRecordEvent = jest.fn();
let mockRecap: { data?: TAgencyRecap; isLoading: boolean; isError: boolean; isSuccess: boolean };
let mockRecapEnabled = true;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key} ${JSON.stringify(vars)}` : key,
  useDocumentTitle: jest.fn(),
}));

jest.mock('~/hooks/Nav/useDrawerViewport', () => () => false);
jest.mock('~/components/Chat/Menus/OpenSidebar', () => () => null);
jest.mock('~/lib/rum/actions', () => ({ trackAction: jest.fn() }));

jest.mock('~/data-provider', () => ({
  recordAgencyEvent: (event: unknown) => mockRecordEvent(event),
  useGetStartupConfig: () => ({
    data: { agency: { recap: mockRecapEnabled } },
    isLoading: false,
  }),
  useAgencyRecapQuery: () => mockRecap,
}));

const recap: TAgencyRecap = {
  goals: { set: 2, conversations: 5 },
  options: { selected: 1, offered: 3 },
  goalChecks: { offered: 1, continue: 0, refocus: 1, goal_changed: 0 },
  examples: {
    option: {
      type: 'option_selected',
      conversationId: 'c1',
      messageId: 'm1',
      detail: 'Show me a few options',
      createdAt: '2026-10-12T10:00:00.000Z',
    },
  },
};

const renderRecap = () =>
  render(
    <MemoryRouter initialEntries={['/agency']}>
      <Routes>
        <Route path="/agency" element={<AgencyRecap />} />
        <Route path="/c/new" element={<p data-testid="new-chat" />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRecapEnabled = true;
  mockRecap = { data: recap, isLoading: false, isError: false, isSuccess: true };
});

describe('AgencyRecap', () => {
  it('shows a spinner while loading', () => {
    mockRecap = { isLoading: true, isError: false, isSuccess: false };
    renderRecap();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('redirects to a new chat while the recap is off', () => {
    mockRecapEnabled = false;
    renderRecap();
    expect(screen.getByTestId('new-chat')).toBeInTheDocument();
  });

  it('says when the recap cannot be loaded', () => {
    mockRecap = { isLoading: false, isError: true, isSuccess: false };
    renderRecap();
    expect(screen.getByRole('alert')).toHaveTextContent('com_agency_recap_error');
  });

  it('shows counts, links examples to their message, and records the view', () => {
    renderRecap();
    expect(screen.getByText('com_agency_stat_goals').previousSibling).toHaveTextContent('2 / 5');
    expect(screen.getByRole('link', { name: 'com_agency_view_in_chat' })).toHaveAttribute(
      'href',
      '/c/c1?message=m1',
    );
    expect(screen.getByText('com_agency_example_goal_empty')).toBeInTheDocument();
    expect(mockRecordEvent).toHaveBeenCalledWith({ type: 'recap_viewed' });
  });
});
