import { Provider } from 'jotai';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import { SentPromptButton, SentPromptPanel } from '../SentPrompt';

let mockSentPromptOn = true;
let mockQuery: Record<string, unknown>;
const mockUseSentPromptQuery = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: { sentPrompt: mockSentPromptOn } } }),
  useSentPromptQuery: (...args: unknown[]) => {
    mockUseSentPromptQuery(...args);
    return mockQuery;
  },
}));

const userMessage = {
  messageId: 'm1',
  conversationId: 'c1',
  isCreatedByUser: true,
  text: 'Hello',
} as TMessage;

const loaded = {
  isLoading: false,
  isError: false,
  data: {
    sentPrompt: {
      system: 'Be helpful.\n\n<conversation_goal>\nessay\n</conversation_goal>',
      message: 'Hello',
      historyCount: 2,
      tools: ['web_search', 'ask_user_question'],
      truncated: false,
    },
  },
};

function renderMessage(message: TMessage = userMessage) {
  render(
    <Provider>
      <SentPromptButton
        message={message}
        renderButton={({ id, title, icon, ariaExpanded, ariaControls, onClick }) => (
          <button
            id={id}
            type="button"
            aria-label={title}
            aria-expanded={ariaExpanded}
            aria-controls={ariaControls}
            onClick={onClick}
          >
            {icon}
          </button>
        )}
      />
      <SentPromptPanel message={message} />
    </Provider>,
  );
}

const toggle = () => screen.getByRole('button', { name: /com_ui_sent_prompt_(show|hide)/ });

beforeEach(() => {
  jest.clearAllMocks();
  mockSentPromptOn = true;
  mockQuery = loaded;
});

describe('SentPrompt', () => {
  it('appears only on the user’s own messages, with the feature on', () => {
    renderMessage({ ...userMessage, isCreatedByUser: false });
    expect(screen.queryByRole('button')).toBeNull();
    mockSentPromptOn = false;
    renderMessage();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads nothing until opened, then shows everything the message sent', async () => {
    renderMessage();
    expect(screen.queryByRole('region')).toBeNull();
    expect(mockUseSentPromptQuery).toHaveBeenLastCalledWith('c1', 'm1', { enabled: false });

    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(mockUseSentPromptQuery).toHaveBeenLastCalledWith('c1', 'm1', { enabled: true });
    const region = screen.getByRole('region', { name: 'com_ui_sent_prompt_title' });
    expect(region).toHaveTextContent('<conversation_goal>');
    expect(region).toHaveTextContent('com_ui_sent_prompt_history:{"count":2}');
    expect(region).toHaveTextContent('web_search, ask_user_question');
    expect(region).not.toHaveTextContent('com_ui_sent_prompt_truncated');
  });

  it('closes on Escape, giving focus back to its button', async () => {
    renderMessage();
    await userEvent.click(toggle());
    screen.getByRole('region').focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region')).toBeNull();
    expect(toggle()).toHaveFocus();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows loading, a message that was not recorded, and a failure with a retry', async () => {
    mockQuery = { isLoading: true, isError: false };
    renderMessage();
    await userEvent.click(toggle());
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('says when nothing was recorded for the message', async () => {
    mockQuery = { isLoading: false, isError: true, error: { response: { status: 404 } } };
    renderMessage();
    await userEvent.click(toggle());
    expect(screen.getByText('com_ui_sent_prompt_missing')).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    const refetch = jest.fn();
    mockQuery = { isLoading: false, isError: true, error: { response: { status: 500 } }, refetch };
    renderMessage();
    await userEvent.click(toggle());
    expect(screen.getByText('com_ui_sent_prompt_error')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('says when long text was cut short', async () => {
    mockQuery = {
      ...loaded,
      data: { sentPrompt: { ...loaded.data.sentPrompt, truncated: true, tools: [] } },
    };
    renderMessage();
    await userEvent.click(toggle());
    expect(screen.getByText('com_ui_sent_prompt_truncated')).toBeInTheDocument();
    expect(screen.getByRole('region')).not.toHaveTextContent('com_ui_sent_prompt_tools');
  });
});
