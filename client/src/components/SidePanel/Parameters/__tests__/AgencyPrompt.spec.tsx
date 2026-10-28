import { Provider, createStore } from 'jotai';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { safeguardingNoticeAtom } from '~/store/safeguarding';
import AgencyPrompt from '../AgencyPrompt';

const DEFAULT = 'Be helpful.{{#goal}} Aim at {{goal}}.{{/goal}}';

const mockSave = jest.fn();
const mockReset = jest.fn();
const mockShowToast = jest.fn();
const mockAnnounce = jest.fn();
let mockQuery: { data?: unknown; isLoading: boolean; isError: boolean; refetch?: jest.Mock };
let mockSaveResult: { ok: unknown } | { error: unknown };

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values?.tag != null ? `${key}:${values.line}:${values.tag}` : key,
}));

jest.mock('~/Providers', () => ({
  useLiveAnnouncer: () => ({ announcePolite: mockAnnounce }),
}));

type Callbacks = { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void };

jest.mock('~/data-provider', () => ({
  useAgencyPromptQuery: () => mockQuery,
  useUpdateAgencyPromptMutation: (options: Callbacks) => ({
    isLoading: false,
    mutate: (template: string) => {
      mockSave(template);
      if ('error' in mockSaveResult) {
        options.onError?.(mockSaveResult.error);
      } else {
        options.onSuccess?.(mockSaveResult.ok);
      }
    },
  }),
  useResetAgencyPromptMutation: (options: Callbacks) => ({
    isLoading: false,
    mutate: () => {
      mockReset();
      options.onSuccess?.({ prompt: { template: null } });
    },
  }),
}));

const loaded = (template: string | null) => ({
  data: { prompt: { template }, default: DEFAULT },
  isLoading: false,
  isError: false,
});

const field = () => screen.getByRole('textbox', { name: 'com_agency_prompt_label' });
const saveButton = () => screen.getByRole('button', { name: 'com_ui_save' });

function renderPrompt() {
  const store = createStore();
  render(
    <Provider store={store}>
      <AgencyPrompt />
    </Provider>,
  );
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = loaded(null);
  mockSaveResult = { ok: { prompt: { template: 'Be brief.' }, masked: false } };
});

describe('AgencyPrompt', () => {
  it('shows a spinner while loading, and a retry when loading fails', async () => {
    mockQuery = { isLoading: true, isError: false };
    const { unmount } = render(<AgencyPrompt />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    unmount();

    const refetch = jest.fn();
    mockQuery = { isLoading: false, isError: true, refetch };
    render(<AgencyPrompt />);
    expect(screen.getByText('com_agency_prompt_load_error')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows the default, marked as such, with nothing to save or reset', () => {
    renderPrompt();
    expect(field()).toHaveValue(DEFAULT);
    expect(screen.getByText('com_agency_prompt_default')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'com_agency_prompt_reset' })).toBeNull();
  });

  it('lists template mistakes as they are typed, blocking the save until they are fixed', async () => {
    renderPrompt();
    await userEvent.clear(field());
    await userEvent.type(field(), 'Be brief.{{{{#goal}} Aim.', { delay: null });
    const alert = await screen.findByText(
      /com_agency_prompt_error_unclosed_section:1:\{\{#goal\}\}/,
    );
    expect(alert).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(saveButton()).toBeDisabled();

    await userEvent.type(field(), '{{{{/goal}}', { delay: null });
    await waitFor(() =>
      expect(screen.queryByText(/com_agency_prompt_error_/)).not.toBeInTheDocument(),
    );
    expect(saveButton()).toBeEnabled();
    await userEvent.click(saveButton());
    expect(mockSave).toHaveBeenCalledWith('Be brief.{{#goal}} Aim.{{/goal}}');
    expect(mockShowToast).toHaveBeenCalledWith({ message: 'com_agency_prompt_saved' });
  });

  it('checks what is in the field at the moment Save is pressed', async () => {
    renderPrompt();
    await userEvent.clear(field());
    await userEvent.type(field(), 'ok', { delay: null });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.type(field(), ' {{{{gaol}}', { delay: null });
    await userEvent.click(saveButton());
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByText(/com_agency_prompt_error_unknown_variable/)).toBeInTheDocument();
  });

  it('shows the mistakes the server found, and says when it masked personal details', async () => {
    mockSaveResult = {
      error: {
        response: {
          data: {
            code: 'invalid_template',
            errors: [{ code: 'malformed_tag', line: 3, column: 1, tag: '{{ x}}' }],
          },
        },
      },
    };
    renderPrompt();
    await userEvent.type(field(), ' More.', { delay: null });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    expect(screen.getByText('com_agency_prompt_error_malformed_tag:3:{{ x}}')).toBeInTheDocument();

    mockSaveResult = { ok: { prompt: { template: 'Call {PHONE}.' }, masked: true } };
    await userEvent.type(field(), '!', { delay: null });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    expect(field()).toHaveValue('Call {PHONE}.');
    expect(screen.getByText('com_agency_prompt_masked')).toBeInTheDocument();
  });

  it('opens the safeguarding notice for blocked instructions, and toasts other failures', async () => {
    const info = { source: 'instructions', reasons: [] };
    mockSaveResult = { error: { response: { data: { type: 'safeguarding', info } } } };
    const store = renderPrompt();
    await userEvent.type(field(), ' More.', { delay: null });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    expect(store.get(safeguardingNoticeAtom)).toEqual(info);

    mockSaveResult = { error: new Error('network') };
    await userEvent.click(saveButton());
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_agency_prompt_save_error',
      status: 'error',
    });
  });

  it('fills in the default when it arrives after the field has rendered', () => {
    mockQuery = { isLoading: true, isError: false };
    const store = createStore();
    const view = () => (
      <Provider store={store}>
        <AgencyPrompt />
      </Provider>
    );
    const { rerender } = render(view());
    mockQuery = loaded(null);
    rerender(view());
    expect(field()).toHaveValue(DEFAULT);
    expect(screen.queryByText(/com_agency_prompt_error_/)).toBeNull();
  });

  it('saves an empty template, for messages on their own', async () => {
    mockSaveResult = { ok: { prompt: { template: '' }, masked: false } };
    renderPrompt();
    await userEvent.clear(field());
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    expect(mockSave).toHaveBeenCalledWith('');
    expect(field()).toHaveValue('');
  });

  it('keeps unsaved edits when the saved instructions change underneath', async () => {
    const store = createStore();
    const view = () => (
      <Provider store={store}>
        <AgencyPrompt />
      </Provider>
    );
    const { rerender } = render(view());
    await userEvent.type(field(), ' Mine.', { delay: null });
    mockQuery = loaded('Changed elsewhere.');
    rerender(view());
    expect(field()).toHaveValue(`${DEFAULT} Mine.`);
  });

  it('follows the saved instructions while nothing is being edited', () => {
    const store = createStore();
    const view = () => (
      <Provider store={store}>
        <AgencyPrompt />
      </Provider>
    );
    const { rerender } = render(view());
    mockQuery = loaded('Changed elsewhere.');
    rerender(view());
    expect(field()).toHaveValue('Changed elsewhere.');
  });

  it('resets customised instructions to the default, and says so', async () => {
    mockQuery = loaded('Be brief.');
    renderPrompt();
    expect(field()).toHaveValue('Be brief.');
    expect(screen.getByText('com_agency_prompt_customised')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_prompt_reset' }));
    expect(mockReset).toHaveBeenCalled();
    expect(field()).toHaveValue(DEFAULT);
    expect(mockAnnounce).toHaveBeenCalledWith({
      message: 'com_agency_prompt_reset_done',
      isStatus: true,
    });
  });
});
