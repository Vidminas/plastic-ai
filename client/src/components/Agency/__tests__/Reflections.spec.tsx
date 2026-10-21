import { Provider, createStore } from 'jotai';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TAgencyReflection } from 'librechat-data-provider';
import { safeguardingNoticeAtom } from '~/store/safeguarding';
import { reflectionDialogAtom } from '~/store/agency';
import ReflectionDialog from '../Reflections';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockShowToast = jest.fn();
let mockEnabled = true;
let mockReflections: TAgencyReflection[] = [];
let mockFailure: unknown = null;

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key} ${JSON.stringify(vars)}` : key,
}));

jest.mock('~/lib/rum/actions', () => ({ trackAction: jest.fn() }));

const mutation =
  (mock: jest.Mock) =>
  (options?: { onSuccess?: () => void; onError?: (error: unknown) => void }) => ({
    mutate: (variables: unknown) => {
      mock(variables);
      if (mockFailure != null) {
        options?.onError?.(mockFailure);
      } else {
        options?.onSuccess?.();
      }
    },
    isLoading: false,
  });

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { agency: { reflections: mockEnabled } } }),
  useAgencyReflectionsQuery: () => ({
    data: { reflections: mockReflections },
    isLoading: false,
    isError: false,
  }),
  useCreateAgencyReflectionMutation: (options: never) => mutation(mockCreate)(options),
  useUpdateAgencyReflectionMutation: (options: never) => mutation(mockUpdate)(options),
}));

const saved: TAgencyReflection = {
  id: 'r1',
  answers: {
    working_on: 'History essay',
    decision: 'Asked for questions instead',
    reason: '',
    outcome: 'Took longer, but clearer',
    happy: 'Yes',
  },
  createdAt: '2026-10-12T10:00:00.000Z',
  updatedAt: '2026-10-13T09:30:00.000Z',
};

const renderOpen = (state: { reflectionId?: string } = {}) => {
  const store = createStore();
  store.set(reflectionDialogAtom, state);
  render(
    <Provider store={store}>
      <ReflectionDialog />
    </Provider>,
  );
  return store;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEnabled = true;
  mockReflections = [];
  mockFailure = null;
});

describe('ReflectionDialog', () => {
  it('stays closed while reflections are off', () => {
    mockEnabled = false;
    renderOpen();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks the questions one at a time, skipping any, and saves the answers', async () => {
    renderOpen();
    expect(screen.getByText('com_agency_reflection_none')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /com_agency_reflection_new/ }));

    expect(screen.getByText('com_agency_reflection_step {"0":1,"1":5}')).toBeInTheDocument();
    const next = () => screen.getByRole('button', { name: 'com_ui_next' });
    expect(next()).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText('com_agency_reflection_q_working_on'),
      'my history essay',
    );
    await userEvent.click(next());

    await userEvent.type(
      screen.getByLabelText('com_agency_reflection_q_decision'),
      'asked for questions',
    );
    await userEvent.click(next());
    /** The answers so far stay on screen above the question. */
    expect(screen.getByText('my history essay')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_skip' }));
    expect(screen.getByText('com_agency_reflection_skipped')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('com_agency_reflection_q_outcome'), 'clearer');
    await userEvent.click(next());

    expect(screen.getByLabelText('com_agency_reflection_q_happy')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('com_agency_reflection_q_happy'), ' yes ');
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_reflection_save' }));

    expect(mockCreate).toHaveBeenCalledWith({
      answers: {
        working_on: 'my history essay',
        decision: 'asked for questions',
        reason: '',
        outcome: 'clearer',
        happy: 'yes',
      },
    });
    expect(mockShowToast).toHaveBeenCalledWith({ message: 'com_agency_reflection_saved' });
    /** Back to the list, ready for another. */
    expect(screen.getByRole('button', { name: /com_agency_reflection_new/ })).toBeInTheDocument();
  });

  it('goes back to change an answer', async () => {
    renderOpen();
    await userEvent.click(screen.getByRole('button', { name: /com_agency_reflection_new/ }));
    await userEvent.type(screen.getByLabelText('com_agency_reflection_q_working_on'), 'maths');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_next' }));
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_back' }));
    expect(screen.getByLabelText('com_agency_reflection_q_working_on')).toHaveValue('maths');
  });

  it('lists saved reflections with when they were saved and edited, to review and edit', async () => {
    mockReflections = [saved];
    renderOpen();
    const list = screen.getByRole('list', { name: 'com_agency_reflection_list' });
    const item = within(list).getByRole('listitem');
    expect(within(item).getByText('History essay')).toBeInTheDocument();
    expect(item.querySelectorAll('time')).toHaveLength(2);
    expect(item.querySelectorAll('time')[0]).toHaveAttribute('datetime', saved.createdAt);

    await userEvent.click(
      within(item).getByRole('button', { name: 'com_agency_reflection_review' }),
    );
    expect(within(item).getByText('Took longer, but clearer')).toBeInTheDocument();
    expect(within(item).getByText('com_agency_reflection_skipped')).toBeInTheDocument();

    await userEvent.click(within(item).getByRole('button', { name: 'com_ui_edit' }));
    expect(screen.getByLabelText('com_agency_reflection_q_working_on')).toHaveValue(
      'History essay',
    );
    for (let i = 0; i < 4; i++) {
      const button = screen.getByRole('button', { name: 'com_ui_next' });
      if (button.hasAttribute('disabled')) {
        await userEvent.click(screen.getByRole('button', { name: 'com_ui_skip' }));
      } else {
        await userEvent.click(button);
      }
    }
    await userEvent.clear(screen.getByLabelText('com_agency_reflection_q_happy'));
    await userEvent.type(screen.getByLabelText('com_agency_reflection_q_happy'), 'Mostly');
    await userEvent.click(screen.getByRole('button', { name: 'com_agency_reflection_save' }));
    expect(mockUpdate).toHaveBeenCalledWith({
      reflectionId: 'r1',
      reflection: { answers: { ...saved.answers, happy: 'Mostly' } },
    });
  });

  it('opens straight to the reflection the recap names', () => {
    mockReflections = [saved];
    renderOpen({ reflectionId: 'r1' });
    expect(screen.getByLabelText('com_agency_reflection_q_working_on')).toHaveValue(
      'History essay',
    );
  });

  it('shows why a reflection was refused, and stays on it', async () => {
    const info = { source: 'reflection', reasons: [{ type: 'topic', name: 'self-harm' }] };
    mockFailure = { response: { status: 422, data: { type: 'safeguarding', info } } };
    const store = renderOpen();
    await userEvent.click(screen.getByRole('button', { name: /com_agency_reflection_new/ }));
    await userEvent.type(screen.getByLabelText('com_agency_reflection_q_working_on'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_next' }));
    for (let i = 0; i < 4; i++) {
      await userEvent.click(
        screen.getByRole('button', {
          name: i < 3 ? 'com_ui_skip' : 'com_agency_reflection_skip_save',
        }),
      );
    }
    expect(store.get(safeguardingNoticeAtom)).toEqual(info);
    expect(screen.getByLabelText('com_agency_reflection_q_happy')).toBeInTheDocument();
  });
});
