import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import {
  pendingGoalAtom,
  goalCardStepAtom,
  heldGoalCheckAtom,
  goalEditorOpenAtom,
  goalEditorHostAtom,
} from '~/store/agency';
import { GoalBanner, GoalCard, useGoalCardAsking } from '../Goal';

const mockRecordEvent = jest.fn();
const mockMutate = jest.fn();
const mockShowToast = jest.fn();
let mockGoal: { text: string } | null = null;
let mockEnabled = true;
let mockSaveSucceeds = false;

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/lib/rum/actions', () => ({ trackAction: jest.fn() }));

jest.mock('~/data-provider', () => ({
  recordAgencyEvent: (event: unknown) => mockRecordEvent(event),
  useGetStartupConfig: () => ({ data: { agency: { conversationGoal: mockEnabled } } }),
  useConversationGoalQuery: () => ({ data: { goal: mockGoal }, isLoading: false }),
  useUpdateConversationGoalMutation: (options?: { onSuccess?: () => void }) => ({
    mutate: (variables: unknown) => {
      mockMutate(variables);
      if (mockSaveSucceeds) {
        options?.onSuccess?.();
      }
    },
    isLoading: false,
  }),
}));

const renderWith = (ui: JSX.Element, url = '/c/new') => {
  const store = createStore();
  render(
    <MemoryRouter initialEntries={[url]}>
      <Provider store={store}>{ui}</Provider>
    </MemoryRouter>,
  );
  return store;
};

/** Stands in for ChatView: the composer shows only once the card stops asking. */
function Landing() {
  const asking = useGoalCardAsking();
  return (
    <>
      <GoalCard />
      {!asking && <textarea data-testid="composer" />}
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGoal = null;
  mockEnabled = true;
  mockSaveSucceeds = false;
});

describe('GoalCard', () => {
  it('stands in for the composer, focused, until a goal is set', async () => {
    const store = renderWith(<Landing />);
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveFocus();

    await userEvent.type(screen.getByRole('textbox'), 'plan my essay');
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_goal_set' }));

    expect(store.get(pendingGoalAtom)).toBe('plan my essay');
    expect(screen.getByText('plan my essay')).toBeInTheDocument();
    expect(screen.getByTestId('composer')).toBeInTheDocument();
  });

  it('records a skip and brings the composer back', async () => {
    const store = renderWith(<Landing />);
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_skip' }));

    expect(mockRecordEvent).toHaveBeenCalledWith({ type: 'goal_skipped' });
    expect(store.get(pendingGoalAtom)).toBeNull();
    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('offers the card again after a skip, and records the skip once', async () => {
    renderWith(<Landing />);
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_skip' }));

    const add = screen.getByRole('button', { name: /com_agency_goal_add/ });
    expect(add.parentElement).toHaveClass('text-text-secondary');
    await userEvent.click(add);
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_skip' }));
    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
  });

  it('cancels an edit back to the goal already set, without skipping', async () => {
    const store = renderWith(<Landing />);
    await userEvent.type(screen.getByRole('textbox'), 'first goal');
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_goal_set' }));
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_edit' }));
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));

    expect(store.get(goalCardStepAtom)).toBe('set');
    expect(store.get(pendingGoalAtom)).toBe('first goal');
    expect(mockRecordEvent).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer')).toBeInTheDocument();
  });

  it('leaves a prompt in the address bar to the composer', () => {
    renderWith(<Landing />, '/c/new?prompt=hello');
    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('asks again on the next new conversation', async () => {
    const store = createStore();
    const { unmount } = render(
      <MemoryRouter>
        <Provider store={store}>
          <Landing />
        </Provider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_skip' }));
    unmount();
    expect(store.get(goalCardStepAtom)).toBe('ask');
  });

  it('leaves the composer alone while conversation goals are off', () => {
    mockEnabled = false;
    renderWith(<Landing />);
    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

describe('GoalBanner', () => {
  it("offers to add a goal in the theme's text colour, and saves one", async () => {
    renderWith(<GoalBanner conversationId="c1" />);
    const add = screen.getByRole('button', { name: /com_agency_goal_add/ });
    expect(add.parentElement).toHaveClass('text-text-secondary');
    await userEvent.click(add);
    await userEvent.type(screen.getByRole('textbox'), 'new goal');
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_goal_set' }));

    expect(mockMutate).toHaveBeenCalledWith({ conversationId: 'c1', text: 'new goal' });
  });

  it("shows the conversation's goal with an edit button", () => {
    mockGoal = { text: 'learn regression' };
    renderWith(<GoalBanner conversationId="c1" />);
    expect(screen.getByText('learn regression')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_ui_edit' })).toBeInTheDocument();
  });

  it('shows the same instructions as the first goal panel when changing a goal', async () => {
    mockGoal = { text: 'learn regression' };
    renderWith(<GoalBanner conversationId="c1" />);
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_edit' }));

    expect(screen.getByRole('heading', { name: 'com_agency_goal_question' })).toBeInTheDocument();
    expect(screen.getByText('com_agency_goal_help')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('learn regression');
  });

  it('is the goal editor a goal check can wait on, while it is shown', () => {
    const store = renderWith(<GoalBanner conversationId="c1" />);
    expect(store.get(goalEditorHostAtom)).toBe(true);
  });

  it('sends a held goal-check answer only once the new goal is saved', async () => {
    mockGoal = { text: 'draw a tree' };
    mockSaveSucceeds = true;
    const submit = jest.fn();
    const store = createStore();
    store.set(heldGoalCheckAtom, { submit });
    store.set(goalEditorOpenAtom, true);
    render(
      <MemoryRouter>
        <Provider store={store}>
          <GoalBanner conversationId="c1" />
        </Provider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('com_agency_goal_check_held');
    expect(submit).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'find places to visit');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(mockMutate).toHaveBeenCalledWith({ conversationId: 'c1', text: 'find places to visit' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(store.get(heldGoalCheckAtom)).toBeNull();
  });

  it('drops a held answer on cancel, leaving the question to answer again', async () => {
    mockGoal = { text: 'draw a tree' };
    const submit = jest.fn();
    const store = createStore();
    store.set(heldGoalCheckAtom, { submit });
    store.set(goalEditorOpenAtom, true);
    render(
      <MemoryRouter>
        <Provider store={store}>
          <GoalBanner conversationId="c1" />
        </Provider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));

    expect(submit).not.toHaveBeenCalled();
    expect(store.get(heldGoalCheckAtom)).toBeNull();
    expect(store.get(goalEditorOpenAtom)).toBe(false);
  });
});
