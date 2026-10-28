import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import type { TAgencyRecap } from 'librechat-data-provider';
import AgencyRecap from '../Recap';

const mockRecordEvent = jest.fn();
const mockRecapQuery = jest.fn();
let mockRecap: { data?: TAgencyRecap; isLoading: boolean; isError: boolean; isSuccess: boolean };
let mockRecapEnabled = true;
let mockClassifier: { topics: Array<{ id: string; label: string }> } | undefined;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key} ${JSON.stringify(vars)}` : key,
  useDocumentTitle: jest.fn(),
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('~/hooks/Nav/useDrawerViewport', () => () => false);
jest.mock('~/components/Chat/Menus/OpenSidebar', () => () => null);
jest.mock('~/lib/rum/actions', () => ({ trackAction: jest.fn() }));
jest.mock('~/data-provider', () => ({
  recordAgencyEvent: (event: unknown) => mockRecordEvent(event),
  useGetStartupConfig: () => ({
    data: {
      agency: {
        recap: mockRecapEnabled,
        intentions: true,
        conversationGoal: true,
        reflections: true,
        goalSuggestions: [{ id: 'exams', title: 'Prepare for exams', icon: 'book' }],
        classifier: mockClassifier,
      },
    },
    isLoading: false,
  }),
  useAgencyRecapQuery: (params: unknown) => {
    mockRecapQuery(params);
    return mockRecap;
  },
  useCreateAgencyReflectionMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

const recap: TAgencyRecap = {
  chats: 4,
  topics: [
    { id: 'maths', chats: 2 },
    { id: 'retired', chats: 1 },
    { id: 'unclassified', chats: 1 },
  ],
  support: { hint: 3, explanation: 1, other: 1 },
  goalUsage: [
    { goal: 'exams', conversations: 2, support: { hint: 3 }, topics: { maths: 2 } },
    { goal: 'own', conversations: 1, support: {}, topics: { retired: 1 } },
  ],
  noGoal: { conversations: 1 },
  journey: [
    {
      type: 'goal_set',
      at: '2026-10-14T10:00:00.000Z',
      goal: { text: 'Revise algebra', suggestionId: 'exams' },
      conversationId: 'c2',
    },
    {
      type: 'goal_check',
      at: '2026-10-13T09:00:00.000Z',
      outcome: 'refocus',
      conversationId: 'c1',
      messageId: 'm1',
    },
    { type: 'reflection', at: '2026-10-12T09:00:00.000Z', reflectionId: 'r1', about: 'Essay' },
  ],
  reflections: {
    count: 4,
    recent: [
      {
        id: 'r1',
        answers: {
          working_on: 'History essay',
          decision: 'Asked for questions instead',
          reason: '',
          outcome: '',
          happy: 'Yes, it made me think',
        },
        createdAt: '2026-10-12T09:00:00.000Z',
        updatedAt: '2026-10-12T09:00:00.000Z',
      },
    ],
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
  mockClassifier = { topics: [{ id: 'maths', label: 'Maths' }] };
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

  it('says when the journey cannot be loaded', () => {
    mockRecap = { isLoading: false, isError: true, isSuccess: false };
    renderRecap();
    expect(screen.getByRole('alert')).toHaveTextContent('com_agency_recap_error');
  });

  it('shows no message totals, usage charts or interaction counters', () => {
    renderRecap();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('com_agency_recap_title');
    expect(screen.queryByText('com_agency_stat_goals')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('list', { name: 'com_agency_timeline_title' }),
    ).not.toBeInTheDocument();
    expect(mockRecordEvent).toHaveBeenCalledWith({ type: 'recap_viewed' });
  });

  it('takes the focus once it has loaded', () => {
    renderRecap();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('switches the period', async () => {
    renderRecap();
    expect(mockRecapQuery).toHaveBeenLastCalledWith({ range: '7d' });
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_range_30d' }));
    expect(mockRecapQuery).toHaveBeenLastCalledWith({ range: '30d' });
  });

  it("shows each goal's share of chats with its main topics and kinds of help", () => {
    renderRecap();
    const table = screen.getByRole('table', { name: 'com_agency_goals_usage_title' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Prepare for exams',
      'com_agency_goals_usage_own',
      'com_agency_goals_usage_none',
    ]);
    expect(
      within(rows[0])
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['50%', 'Maths', 'com_agency_support_hint']);
    /** A topic no longer configured counts as "something else". */
    expect(within(rows[1]).getByText('com_agency_topic_other')).toBeInTheDocument();
    expect(within(rows[2]).getAllByRole('cell')[0]).toHaveTextContent('25%');
  });

  it('shows topics and types of use as shares', () => {
    renderRecap();
    expect(screen.getByRole('meter', { name: 'Maths' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('meter', { name: 'com_agency_support_hint' })).toHaveAttribute(
      'aria-valuenow',
      '60',
    );
  });

  it('links goal changes and goal checks to their chat moments, and reflections to the dialog', () => {
    renderRecap();
    expect(screen.getByText('com_agency_journey_set {"0":"Revise algebra"}')).toBeInTheDocument();
    expect(screen.getByText('com_agency_journey_check_refocus')).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('link', { name: 'com_agency_view_in_chat' })
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/c/c2', '/c/c1?message=m1']);
    expect(screen.getByRole('button', { name: 'com_agency_reflection_open' })).toBeInTheDocument();
  });

  it('notices what stands out as shares', () => {
    renderRecap();
    expect(
      screen.getByText('com_agency_takeaway_top_goal {"0":"Prepare for exams","1":50}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('com_agency_takeaway_top_topic {"0":"Maths","1":50}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('com_agency_takeaway_top_support {"0":"com_agency_support_hint","1":60}'),
    ).toBeInTheDocument();
    expect(screen.getByText('com_agency_takeaway_no_goal {"count":1}')).toBeInTheDocument();
  });

  it('leaves out topics and types of use without a classifier', () => {
    mockClassifier = undefined;
    renderRecap();
    expect(screen.queryByText('com_agency_topics_title')).not.toBeInTheDocument();
    expect(screen.queryByText('com_agency_support_title')).not.toBeInTheDocument();
    expect(screen.queryByText('com_agency_goals_usage_topics')).not.toBeInTheDocument();
  });

  it("gives an overview of the period's reflections, each opening in the dialog", async () => {
    renderRecap();
    const list = screen.getByRole('list', { name: 'com_agency_recap_reflections_title' });
    expect(screen.getByText('com_agency_recap_reflections_count {"count":4}')).toBeInTheDocument();
    expect(within(list).getByText('History essay')).toBeInTheDocument();
    expect(within(list).getByText('Asked for questions instead')).toBeInTheDocument();
    expect(within(list).getByText('Yes, it made me think')).toBeInTheDocument();
    /** An unanswered question is left out rather than shown empty. */
    expect(within(list).getAllByRole('definition')).toHaveLength(2);
    expect(
      within(list).getByRole('button', {
        name: 'com_agency_recap_reflection_open {"0":"History essay"}',
      }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'com_agency_recap_reflections_all' })).toBeEnabled();
  });

  it('invites a first reflection when none was saved in the period', () => {
    mockRecap = {
      ...mockRecap,
      data: { ...recap, reflections: { count: 0, recent: [] } },
    };
    renderRecap();
    expect(screen.getByText(/com_agency_recap_reflections_empty/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'com_agency_recap_reflections_write' }),
    ).toBeEnabled();
  });
});
