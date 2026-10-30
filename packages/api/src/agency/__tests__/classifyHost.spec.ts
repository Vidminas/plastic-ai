import { initializeModel } from '@librechat/agents';
import type { Request } from 'express';
import { createAgencyClassifierInvoker } from '../classifyHost';

jest.mock('@librechat/agents', () => ({
  ...jest.requireActual('@librechat/agents'),
  initializeModel: jest.fn(),
}));

const invokeModel = jest.fn();

async function optionsFor(model: string, bedrock: object = {}) {
  const invoke = createAgencyClassifierInvoker({ db: {} as never, usage: {} as never });
  const request = {
    user: { id: 'user-1' },
    body: {},
    config: {
      agency: { classifier: { endpoint: 'bedrock', model, topics: [] } },
      endpoints: { bedrock: { models: [model], ...bedrock } },
    },
  };
  await expect(
    invoke(request as unknown as Request, 'prompt', { conversationId: 'convo-1' }),
  ).resolves.toBe('{"support":"hint"}');
  return (initializeModel as jest.Mock).mock.calls[0][0].clientOptions;
}

describe('createAgencyClassifierInvoker', () => {
  const env = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...env,
      BEDROCK_AWS_DEFAULT_REGION: 'eu-west-2',
      BEDROCK_AWS_ACCESS_KEY_ID: 'test-key',
      BEDROCK_AWS_SECRET_ACCESS_KEY: 'test-secret',
    };
    invokeModel.mockResolvedValue({ content: '{"support":"hint"}' });
    (initializeModel as jest.Mock).mockReturnValue({ invoke: invokeModel });
  });

  afterAll(() => {
    process.env = env;
  });

  it('keeps Sonnet 5.5 from thinking, within the small output cap', async () => {
    const options = await optionsFor('eu.anthropic.claude-sonnet-5-5');
    expect(options).toMatchObject({
      model: 'eu.anthropic.claude-sonnet-5-5',
      maxTokens: 256,
      streaming: false,
    });
    expect(options.additionalModelRequestFields.thinking).toEqual({ type: 'between_tools' });
  });

  it('turns thinking off explicitly on Sonnet 5, its fallback', async () => {
    const options = await optionsFor('eu.anthropic.claude-sonnet-5');
    expect(options.additionalModelRequestFields.thinking).toEqual({ type: 'disabled' });
  });

  it('keeps both limits when Sonnet 5.5 falls back to Sonnet 5', async () => {
    const { initializeModel: realInitialize } = jest.requireActual('@librechat/agents');
    const requests: Array<{
      modelId?: string;
      inferenceConfig?: { maxTokens?: number };
      additionalModelRequestFields?: { thinking?: unknown };
    }> = [];
    (initializeModel as jest.Mock).mockImplementation(({ provider, clientOptions }) => {
      clientOptions.client.middlewareStack.add(
        () => async (args: { input: (typeof requests)[number] }) => {
          requests.push(args.input);
          if (requests.length === 1) {
            throw Object.assign(new Error('busy'), { name: 'ServiceUnavailableException' });
          }
          return {
            response: {},
            output: {
              $metadata: {},
              stopReason: 'end_turn',
              output: { message: { role: 'assistant', content: [{ text: '{"support":"hint"}' }] } },
            },
          };
        },
        { step: 'serialize', name: 'answerAfterBusy', priority: 'high' },
      );
      return realInitialize({ provider, clientOptions });
    });

    await optionsFor('eu.anthropic.claude-sonnet-5-5', {
      retry: {
        maxAttempts: 2,
        fallbacks: { 'eu.anthropic.claude-sonnet-5-5': 'eu.anthropic.claude-sonnet-5' },
      },
    });

    expect(requests).toEqual([
      expect.objectContaining({
        modelId: 'eu.anthropic.claude-sonnet-5-5',
        inferenceConfig: expect.objectContaining({ maxTokens: 256 }),
        additionalModelRequestFields: expect.objectContaining({
          thinking: { type: 'between_tools' },
        }),
      }),
      expect.objectContaining({
        modelId: 'eu.anthropic.claude-sonnet-5',
        inferenceConfig: expect.objectContaining({ maxTokens: 256 }),
        additionalModelRequestFields: expect.objectContaining({ thinking: { type: 'disabled' } }),
      }),
    ]);
  });

  it('sends a model without thinking no request fields', async () => {
    const options = await optionsFor('amazon.nova-lite-v1:0');
    expect(options.additionalModelRequestFields).toBeUndefined();
  });
});
