import { Provider, createStore } from 'jotai';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import AgencyIntentions, { IntentionsDialog } from '../Intentions';
import { safeguardingNoticeAtom } from '~/store/safeguarding';
import { intentionsDialogAtom } from '~/store/agency';

const mockMutate = jest.fn();
const mockShowToast = jest.fn();
let mockSaveError: unknown = null;
let mockQuery: { data?: unknown; isLoading: boolean; isError: boolean };
let mockIntentionsOn = true;

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/lib/rum/actions', () => ({ trackAction: jest.fn() }));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { agency: { intentions: mockIntentionsOn } } }),
  useAgencyIntentionsQuery: () => mockQuery,
  useUpdateAgencyIntentionsMutation: (options?: { onError?: (error: unknown) => void }) => ({
    mutate: (variables: unknown) => {
      mockMutate(variables);
      if (mockSaveError != null) {
        options?.onError?.(mockSaveError);
      }
    },
    isLoading: false,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveError = null;
  mockIntentionsOn = true;
  mockQuery = { data: { intentions: null }, isLoading: false, isError: false };
});

describe('AgencyIntentions', () => {
  it('shows a spinner while loading', () => {
    mockQuery = { isLoading: true, isError: false };
    render(<AgencyIntentions />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('says when the intentions cannot be loaded', () => {
    mockQuery = { isLoading: false, isError: true };
    render(<AgencyIntentions />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_agency_intentions_load_error');
  });

  it('fills in saved intentions and saves the edited ones with factor ratings', async () => {
    mockQuery = {
      data: {
        intentions: { goals: 'stats', intendedUse: '', commitments: '', factors: { guiding: 2 } },
      },
      isLoading: false,
      isError: false,
    };
    render(<AgencyIntentions />);
    expect(screen.getByLabelText('com_agency_goals')).toHaveValue('stats');

    await userEvent.type(screen.getByLabelText('com_agency_commitments'), 'no graded work');
    const reflecting = screen.getByRole('radiogroup', { name: 'com_agency_factor_reflecting' });
    await userEvent.click(
      Array.from(reflecting.querySelectorAll('[role="radio"]')).find(
        (radio) => radio.textContent === 'com_agency_importance_5',
      ) as Element,
    );
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(mockMutate).toHaveBeenCalledWith({
      goals: 'stats',
      intendedUse: '',
      commitments: 'no graded work',
      factors: { guiding: 2, reflecting: 5 },
    });
  });

  it('opens the safeguarding notice when the intentions are blocked', async () => {
    const info = { source: 'intentions', reasons: [{ type: 'topic', name: 'self-harm' }] };
    mockSaveError = { response: { status: 422, data: { type: 'safeguarding', info } } };
    const store = createStore();
    render(
      <Provider store={store}>
        <AgencyIntentions />
      </Provider>,
    );
    await userEvent.type(screen.getByLabelText('com_agency_goals'), 'something');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(store.get(safeguardingNoticeAtom)).toEqual(info);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('shows the save error for any other failure', async () => {
    mockSaveError = { response: { status: 500, data: { message: 'Failed' } } };
    render(<AgencyIntentions />);
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_agency_intentions_save_error', status: 'error' }),
    );
  });
});

describe('IntentionsDialog', () => {
  const renderOpen = () => {
    const store = createStore();
    store.set(intentionsDialogAtom, true);
    render(
      <Provider store={store}>
        <IntentionsDialog />
      </Provider>,
    );
    return store;
  };

  it('opens from the sidebar with the intentions form, and closes', async () => {
    const store = renderOpen();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('com_agency_intentions_title');
    expect(dialog).toHaveTextContent('com_agency_intentions_intro');
    expect(screen.getByLabelText('com_agency_goals')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(store.get(intentionsDialogAtom)).toBe(false);
  });

  it('stays closed while intentions are off', () => {
    mockIntentionsOn = false;
    renderOpen();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
