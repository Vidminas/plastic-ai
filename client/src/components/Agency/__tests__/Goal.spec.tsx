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
const mockSubmitMessage = jest.fn();
let mockGoal: { text: string; suggestionId?: string } | null = null;
let mockEnabled = true;
let mockSaveSucceeds = false;
let mockSuggestions: Array<{ id: string; title: string; icon?: string }> = [];

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useSubmitMessage: () => ({ submitMessage: mockSubmitMessage }),
}));

jest.mock('~/lib/rum/actions', () => ({ trackAction: jest.fn() }));

jest.mock('~/data-provider', () => ({
  recordAgencyEvent: (event: unknown) => mockRecordEvent(event),
  useGetStartupConfig: () => ({
    data: {
      agency: {
        conversationGoal: mockEnabled,
        ...(mockSuggestions.length > 0 ? { goalSuggestions: mockSuggestions } : {}),
      },
    },
  }),
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
  mockSubmitMessage.mockReset();
  mockGoal = null;
  mockEnabled = true;
  mockSaveSucceeds = false;
  mockSuggestions = [];
});

describe('GoalCard', () => {
  it('stands in for the composer, focused, until a goal is set', async () => {
    const store = renderWith(<Landing />);
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveFocus();

    await userEvent.type(screen.getByRole('textbox'), 'plan my essay');
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_goal_start' }));

    expect(store.get(pendingGoalAtom)?.text).toBe('plan my essay');
    expect(screen.getByText('plan my essay')).toBeInTheDocument();
    expect(screen.getByTestId('composer')).toBeInTheDocument();
  });

  it('sends the goal as the first message, carrying the goal with it', async () => {
    const store = renderWith(<Landing />);
    mockSubmitMessage.mockImplementation(() => {
      /** The first message reads the pending goal as it is sent. */
      expect(store.get(pendingGoalAtom)?.text).toBe('plan my essay');
    });
    await userEvent.type(screen.getByRole('textbox'), 'plan my essay');
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_goal_start' }));
    expect(mockSubmitMessage).toHaveBeenCalledWith({ text: 'plan my essay' });
    expect(mockSubmitMessage).toHaveBeenCalledTimes(1);
  });

  it('leaves a sent goal for the first message to take when the card goes', async () => {
    const store = createStore();
    const { unmount } = render(
      <MemoryRouter>
        <Provider store={store}>
          <Landing />
        </Provider>
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByRole('textbox'), 'plan my essay');
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_goal_start' }));
    unmount();
    expect(store.get(pendingGoalAtom)?.text).toBe('plan my essay');
    expect(store.get(goalCardStepAtom)).toBe('ask');
  });

  it('keeps the goal for the composer when the first message is refused', async () => {
    mockSubmitMessage.mockReturnValue(false);
    const store = renderWith(<Landing />);
    await userEvent.type(screen.getByRole('textbox'), 'plan my essay');
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_goal_start' }));
    expect(store.get(goalCardStepAtom)).toBe('set');
    expect(store.get(pendingGoalAtom)?.text).toBe('plan my essay');
    expect(screen.getByTestId('composer')).toBeInTheDocument();
  });

  it('sends nothing on a skip', async () => {
    renderWith(<Landing />);
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_skip' }));
    expect(mockSubmitMessage).not.toHaveBeenCalled();
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
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_goal_start' }));
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_edit' }));
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));

    expect(store.get(goalCardStepAtom)).toBe('set');
    expect(store.get(pendingGoalAtom)?.text).toBe('first goal');
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

describe('GoalCard with suggested goals', () => {
  beforeEach(() => {
    mockSuggestions = [
      { id: 'exams', title: 'Prepare for exams', icon: 'book' },
      { id: 'writing', title: 'Get better at writing', icon: 'pen' },
    ];
  });

  it("combines a chosen suggestion with optional words of the learner's own", async () => {
    const store = renderWith(<Landing />);
    await userEvent.click(screen.getByRole('button', { name: 'Prepare for exams' }));
    expect(screen.getByRole('button', { name: 'Prepare for exams' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByLabelText('com_agency_goal_details_label')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'chemistry mock');
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_goal_start' }));

    expect(store.get(pendingGoalAtom)).toEqual({
      text: 'Prepare for exams: chemistry mock',
      suggestionId: 'exams',
    });
  });

  it('sets a chosen suggestion alone once the learner deletes what they typed', async () => {
    const store = renderWith(<Landing />);
    await userEvent.click(screen.getByRole('button', { name: 'Prepare for exams' }));
    await userEvent.type(screen.getByRole('textbox'), 'maths');
    await userEvent.clear(screen.getByRole('textbox'));
    const set = screen.getByRole('button', { name: 'com_agency_goal_start' });
    expect(set).toBeEnabled();
    await userEvent.click(set);
    expect(store.get(pendingGoalAtom)).toEqual({
      text: 'Prepare for exams',
      suggestionId: 'exams',
    });
  });

  it("keeps the learner's words across suggestions, and needs words once none is chosen", async () => {
    const store = renderWith(<Landing />);
    await userEvent.type(screen.getByRole('textbox'), 'my own goal');
    await userEvent.click(screen.getByRole('button', { name: 'Get better at writing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Prepare for exams' }));
    expect(screen.getByRole('textbox')).toHaveValue('my own goal');
    await userEvent.click(screen.getByRole('button', { name: 'Prepare for exams' }));
    await userEvent.clear(screen.getByRole('textbox'));
    expect(screen.getByRole('button', { name: 'com_agency_goal_start' })).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox'), 'just mine');
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_goal_start' }));
    expect(store.get(pendingGoalAtom)).toEqual({ text: 'just mine', suggestionId: null });
  });

  it('reopens a saved goal as plain text, still tied to its suggestion', async () => {
    mockGoal = { text: 'Prepare for exams: chemistry', suggestionId: 'exams' };
    renderWith(<GoalBanner conversationId="c1" />);
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_edit' }));
    expect(screen.getByRole('textbox')).toHaveValue('Prepare for exams: chemistry');
    await userEvent.type(screen.getByRole('textbox'), ' and physics');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(mockMutate).toHaveBeenCalledWith({
      conversationId: 'c1',
      text: 'Prepare for exams: chemistry and physics',
      suggestionId: 'exams',
    });
  });

  it('swaps the title rather than stacking one when a suggestion is picked again', async () => {
    mockGoal = { text: 'Prepare for exams: chemistry', suggestionId: 'exams' };
    renderWith(<GoalBanner conversationId="c1" />);
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Prepare for exams' }));
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(mockMutate).toHaveBeenLastCalledWith({
      conversationId: 'c1',
      text: 'Prepare for exams: chemistry',
      suggestionId: 'exams',
    });

    /** The save is left pending here, so the editor stays open for another pick. */
    await userEvent.click(screen.getByRole('button', { name: 'Get better at writing' }));
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(mockMutate).toHaveBeenLastCalledWith({
      conversationId: 'c1',
      text: 'Get better at writing: chemistry',
      suggestionId: 'writing',
    });
  });

  it('drops the suggestion once the goal no longer starts with its title', async () => {
    mockGoal = { text: 'Prepare for exams: chemistry', suggestionId: 'exams' };
    renderWith(<GoalBanner conversationId="c1" />);
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_edit' }));
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'plan my history essay');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(mockMutate).toHaveBeenCalledWith({
      conversationId: 'c1',
      text: 'plan my history essay',
      suggestionId: null,
    });
  });

  it('sends the suggestion when a goal is changed', async () => {
    mockGoal = { text: 'revise algebra' };
    renderWith(<GoalBanner conversationId="c1" />);
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Prepare for exams' }));
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(mockMutate).toHaveBeenCalledWith({
      conversationId: 'c1',
      text: 'Prepare for exams: revise algebra',
      suggestionId: 'exams',
    });
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
