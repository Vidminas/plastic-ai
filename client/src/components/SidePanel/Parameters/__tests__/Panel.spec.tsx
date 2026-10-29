import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueryKeys, EModelEndpoint, tConvoUpdateSchema } from 'librechat-data-provider';
import type { TConversation, TStartupConfig, TEndpointsConfig } from 'librechat-data-provider';
import { render, screen, fireEvent, waitFor } from 'test/layout-test-utils';
import { startupConfigKey } from '~/data-provider/Endpoints/queries';
import AnnouncerContext from '~/Providers/AnnouncerContext';
import { ChatContext } from '~/Providers';
import Parameters from '../Panel';

jest.mock('../AgencyPrompt', () => ({
  __esModule: true,
  default: () => <div data-testid="prompt-template" />,
}));

const saved = { thinking: false, thinkingBudget: 4096, temperature: 0.7, topP: 0.9, topK: 40 };

function setup(
  endpoint: string,
  model: string,
  startupConfig: Partial<TStartupConfig> = {},
  restored?: TConversation,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const endpoints: TEndpointsConfig = {
    'custom-anthropic': {
      order: 0,
      type: EModelEndpoint.custom,
      customParams: { defaultParamsEndpoint: EModelEndpoint.anthropic },
    },
  };
  queryClient.setQueryData([QueryKeys.endpoints], endpoints);
  queryClient.setQueryData(startupConfigKey(false), startupConfig);

  function Conversation() {
    const [conversation, setConversation] = useState<TConversation | null>(
      restored ??
        ({
          ...saved,
          endpoint,
          model,
          conversationId: 'saved-conversation',
        } as TConversation),
    );
    const value = { conversation, setConversation, preset: null } as React.ContextType<
      typeof ChatContext
    >;
    return (
      <QueryClientProvider client={queryClient}>
        <ChatContext.Provider value={value}>
          <button
            onClick={() =>
              setConversation((prev) => ({ ...prev, model: `${model}-5` }) as TConversation)
            }
          >
            {'Select Opus 5.5'}
          </button>
          <button onClick={() => setConversation((prev) => ({ ...prev, model }) as TConversation)}>
            {'Select Opus 5'}
          </button>
          <output data-testid="conversation">{JSON.stringify(conversation)}</output>
          <AnnouncerContext.Provider
            value={{ announcePolite: jest.fn(), announceAssertive: jest.fn() }}
          >
            <Parameters />
          </AnnouncerContext.Provider>
        </ChatContext.Provider>
      </QueryClientProvider>
    );
  }
  return render(<Conversation />);
}

const readConversation = (): TConversation =>
  JSON.parse(screen.getByTestId('conversation').textContent ?? '{}');

describe.each([
  [EModelEndpoint.anthropic, 'claude-opus-5'],
  [EModelEndpoint.bedrock, 'global.anthropic.claude-opus-5'],
  ['custom-anthropic', 'claude-opus-5'],
])('%s conversation parameters', (endpoint, model) => {
  it('preserves hidden settings through the pruning effect and preset serialization', async () => {
    const { unmount } = setup(endpoint, model);
    expect(screen.getByRole('switch', { name: 'Thinking' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Select Opus 5.5' }));
    expect(screen.queryByRole('switch', { name: 'Thinking' })).not.toBeInTheDocument();
    for (const label of ['Thinking Budget', 'Temperature', 'Top P', 'Top K']) {
      expect(screen.queryAllByLabelText(label)).toHaveLength(0);
    }
    await waitFor(() => expect(readConversation()).toMatchObject(saved));
    const restored = tConvoUpdateSchema.parse(
      JSON.parse(JSON.stringify(readConversation())),
    ) as TConversation;
    expect(restored).toMatchObject(saved);
    unmount();
    setup(endpoint, model, {}, restored);
    expect(screen.queryByRole('switch', { name: 'Thinking' })).not.toBeInTheDocument();
    expect(readConversation()).toMatchObject(saved);

    fireEvent.click(screen.getByRole('button', { name: 'Select Opus 5' }));
    expect(screen.getByRole('switch', { name: 'Thinking' })).not.toBeChecked();
    expect(screen.getByRole('slider', { name: 'Temperature' })).toHaveAttribute(
      'aria-valuenow',
      '0.7',
    );
    expect(readConversation()).toMatchObject(saved);
  });

  it('still clears hidden values on an explicit reset', () => {
    setup(endpoint, model);
    fireEvent.click(screen.getByRole('button', { name: 'Select Opus 5.5' }));
    fireEvent.click(screen.getByRole('button', { name: /Reset Model Parameters/i }));
    for (const key of Object.keys(saved)) {
      expect(readConversation()).not.toHaveProperty(key);
    }
    expect(readConversation()).toMatchObject({ endpoint, model: `${model}-5` });
  });

  it('still removes a hidden setting explicitly dropped by the administrator', async () => {
    setup(endpoint, model, {
      endpointsDropParamsMap: { [endpoint]: { [`${model}-5`]: ['temperature'] } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select Opus 5.5' }));
    await waitFor(() => expect(readConversation()).not.toHaveProperty('temperature'));
    expect(readConversation()).toMatchObject({
      thinking: false,
      thinkingBudget: 4096,
      topP: 0.9,
      topK: 40,
    });
  });
});

describe('prompt template', () => {
  it('sits directly after the system prompt, with conversation goals on', async () => {
    const { container } = setup(EModelEndpoint.bedrock, 'global.anthropic.claude-opus-5', {
      interface: { parameters: true } as TStartupConfig['interface'],
      agency: { conversationGoal: true } as TStartupConfig['agency'],
    });
    const template = await screen.findByTestId('prompt-template');
    const systemPrompt = container.querySelector('[id$="-dynamic-textarea"]');
    expect(systemPrompt).not.toBeNull();
    expect(systemPrompt?.closest('div.col-span-2')?.nextElementSibling).toBe(template);
  });

  it.each([
    ['global.anthropic.claude-opus-5', 'system'],
    ['amazon.nova-lite-v1:0', 'promptPrefix'],
  ])('stays in identity when %s hides its %s field', async (model, key) => {
    setup(EModelEndpoint.bedrock, model, {
      interface: {
        parameters: true,
        hiddenParameters: ['promptPrefix', 'system'],
      } as TStartupConfig['interface'],
      agency: { conversationGoal: true } as TStartupConfig['agency'],
    });
    const template = await screen.findByTestId('prompt-template');
    expect(document.getElementById(`${key}-dynamic-textarea`)).toBeNull();
    expect(template.closest('section')).toBe(screen.getByRole('region', { name: 'Identity' }));
  });

  it('is not shown without conversation goals, or with identity hidden', async () => {
    setup(EModelEndpoint.bedrock, 'global.anthropic.claude-opus-5', {
      interface: {
        parameters: true,
        hiddenParameterSections: ['identity'],
      } as TStartupConfig['interface'],
      agency: { conversationGoal: true } as TStartupConfig['agency'],
    });
    await screen.findAllByRole('heading');
    expect(screen.queryByTestId('prompt-template')).toBeNull();
  });
});
