import {
  ConverseCommand,
  BedrockRuntimeClient,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime';
import type { FallbackRequest } from './retry';
import { backoff, isRetryableBedrockError, retryBedrockReplies } from './retry';

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn() },
}));

const busy = (): Error =>
  Object.assign(new Error('Bedrock is unable to process your request.'), {
    name: 'ServiceUnavailableException',
  });

type Event = ConverseStreamOutput | Error;

/** A stream that yields its events in order, throwing any that is an error. */
async function* streamOf(events: Event[]): AsyncGenerator<ConverseStreamOutput> {
  for (const event of events) {
    if (event instanceof Error) {
      throw event;
    }
    yield event;
  }
}

const start: ConverseStreamOutput = { messageStart: { role: 'assistant' } };
const delta = (text: string): ConverseStreamOutput => ({
  contentBlockDelta: { contentBlockIndex: 0, delta: { text } },
});

/**
 * A real client whose requests never leave the process: a `serialize` middleware answers each
 * send with the next scripted stream, after the retry middleware at `initialize` has run.
 */
function clientAnswering(
  streams: Event[][],
  maxAttempts = 3,
  fallbackModelId?: string,
  {
    sdkAttempts = 1,
    fallbackRequest,
  }: { sdkAttempts?: number; fallbackRequest?: FallbackRequest } = {},
) {
  const client = new BedrockRuntimeClient({
    region: 'eu-west-2',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  /** Called with the model each request went to. */
  const sends = jest.fn();
  client.middlewareStack.add(
    () => async (args) => {
      const events = streams[sends.mock.calls.length] ?? [];
      sends((args.input as { modelId?: string }).modelId, args.input);
      return {
        output: { $metadata: { attempts: sdkAttempts }, stream: streamOf(events) },
        response: {},
      };
    },
    { step: 'serialize', name: 'testAnswer' },
  );
  retryBedrockReplies(client, { maxAttempts, fallbackModelId, fallbackRequest, delay: () => 0 });
  return { client, sends };
}

const send = () =>
  new ConverseStreamCommand({ modelId: 'model', messages: [{ role: 'user', content: [] }] });

async function read(stream: AsyncIterable<ConverseStreamOutput> | undefined): Promise<string> {
  let text = '';
  for await (const event of stream ?? []) {
    text += event.contentBlockDelta?.delta?.text ?? '';
  }
  return text;
}

describe('retryConverseStreams', () => {
  it('sends a streamed reply again when Bedrock is busy before it begins', async () => {
    const { client, sends } = clientAnswering([
      [start, busy()],
      [busy()],
      [start, delta('Hello'), delta(' there')],
    ]);
    const { stream } = await client.send(send());
    expect(await read(stream)).toBe('Hello there');
    expect(sends).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxAttempts tries and passes the error on', async () => {
    const { client, sends } = clientAnswering([[busy()], [busy()], [busy()], [start]], 3);
    await expect(client.send(send())).rejects.toThrow('Bedrock is unable to process');
    expect(sends).toHaveBeenCalledTimes(3);
  });

  it("counts the SDK's own attempts toward the same budget", async () => {
    const { client, sends } = clientAnswering([[busy()], [busy()], [start]], 4, undefined, {
      sdkAttempts: 3,
    });
    await expect(client.send(send())).rejects.toThrow('Bedrock is unable to process');
    expect(sends).toHaveBeenCalledTimes(2);
  });

  it('stops waiting to restart when the reply is cancelled', async () => {
    const client = new BedrockRuntimeClient({
      region: 'eu-west-2',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const controller = new AbortController();
    const sends = jest.fn();
    client.middlewareStack.add(
      () => async () => {
        sends();
        if (sends.mock.calls.length > 1) {
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }
        return { output: { $metadata: {}, stream: streamOf([busy()]) }, response: {} };
      },
      { step: 'serialize', name: 'testAnswer' },
    );
    retryBedrockReplies(client, { maxAttempts: 3, delay: () => 60_000 });
    const sent = client.send(send(), { abortSignal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(sent).rejects.toThrow('aborted');
    expect(sends).toHaveBeenCalledTimes(2);
  });

  it('does not repeat a reply that has already started', async () => {
    const { client, sends } = clientAnswering([[start, delta('Hel'), busy()], [delta('again')]]);
    const { stream } = await client.send(send());
    await expect(read(stream)).rejects.toThrow('Bedrock is unable to process');
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('does not retry an error another try cannot fix', async () => {
    const invalid = Object.assign(new Error('bad input'), { name: 'ValidationException' });
    const { client, sends } = clientAnswering([[invalid], [start, delta('ok')]]);
    await expect(client.send(send())).rejects.toThrow('bad input');
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('sends a reply that is not streamed only once itself, leaving retries to the SDK', async () => {
    const { client, sends } = clientAnswering([[busy()]]);
    const result = await client.send(
      new ConverseCommand({ modelId: 'model', messages: [{ role: 'user', content: [] }] }),
    );
    expect(result).toHaveProperty('stream');
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('adds nothing for a single attempt without a fallback', () => {
    const client = new BedrockRuntimeClient({ region: 'eu-west-2' });
    const add = jest.spyOn(client.middlewareStack, 'add');
    retryBedrockReplies(client, { maxAttempts: 1 });
    expect(add).not.toHaveBeenCalled();
  });
});

describe('retryBedrockReplies with a fallback model', () => {
  it('sends a reply to the fallback once its own model has used its tries', async () => {
    const { client, sends } = clientAnswering(
      [[busy()], [busy()], [start, delta('From the fallback')]],
      2,
      'fallback',
    );
    const { stream } = await client.send(send());
    expect(await read(stream)).toBe('From the fallback');
    expect(sends.mock.calls.map(([modelId]) => modelId)).toEqual(['model', 'model', 'fallback']);
  });

  it('gives the fallback the same tries, then passes the error on', async () => {
    const { client, sends } = clientAnswering(
      [[busy()], [busy()], [busy()], [busy()], [start]],
      2,
      'fallback',
    );
    await expect(client.send(send())).rejects.toThrow('Bedrock is unable to process');
    expect(sends.mock.calls.map(([modelId]) => modelId)).toEqual([
      'model',
      'model',
      'fallback',
      'fallback',
    ]);
  });

  it("sends the fallback its own model settings, keeping the reply's stop sequences", async () => {
    const { client, sends } = clientAnswering([[busy()], [start, delta('ok')]], 1, 'fallback', {
      fallbackRequest: {
        additionalModelRequestFields: { thinking: { type: 'disabled' } },
        inferenceConfig: { maxTokens: 100 },
      },
    });
    await client.send(
      new ConverseStreamCommand({
        modelId: 'model',
        messages: [{ role: 'user', content: [] }],
        additionalModelRequestFields: { thinking: { type: 'between_tools' } },
        inferenceConfig: { maxTokens: 64000, stopSequences: ['END'] },
      }),
    );
    expect(sends.mock.calls[1][1]).toMatchObject({
      modelId: 'fallback',
      additionalModelRequestFields: { thinking: { type: 'disabled' } },
      inferenceConfig: { maxTokens: 100, stopSequences: ['END'] },
    });
  });

  it('falls back when the request itself is turned away', async () => {
    const client = new BedrockRuntimeClient({
      region: 'eu-west-2',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const models: Array<string | undefined> = [];
    client.middlewareStack.add(
      () => async (args) => {
        const { modelId } = args.input as { modelId?: string };
        models.push(modelId);
        if (modelId === 'model') {
          throw busy();
        }
        return {
          output: { $metadata: {}, output: { message: { role: 'assistant' } } },
          response: {},
        };
      },
      { step: 'serialize', name: 'testAnswer' },
    );
    retryBedrockReplies(client, { maxAttempts: 3, fallbackModelId: 'fallback', delay: () => 0 });
    const result = await client.send(
      new ConverseCommand({ modelId: 'model', messages: [{ role: 'user', content: [] }] }),
    );
    expect(result.output?.message?.role).toBe('assistant');
    expect(models).toEqual(['model', 'fallback']);
  });

  it('does not fall back for an error another model cannot fix', async () => {
    const invalid = Object.assign(new Error('bad input'), { name: 'ValidationException' });
    const { client, sends } = clientAnswering([[invalid], [start]], 2, 'fallback');
    await expect(client.send(send())).rejects.toThrow('bad input');
    expect(sends).toHaveBeenCalledTimes(1);
  });
});

describe('backoff', () => {
  it('waits up to the base delay first, doubling to the cap', () => {
    jest.spyOn(Math, 'random').mockReturnValue(1);
    const delay = backoff(100, 300);
    expect([1, 2, 3, 4].map(delay)).toEqual([100, 200, 300, 300]);
    jest.mocked(Math.random).mockRestore();
  });
});

describe('isRetryableBedrockError', () => {
  it.each([
    'ServiceUnavailableException',
    'ThrottlingException',
    'InternalServerException',
    'ModelStreamErrorException',
    'ModelNotReadyException',
  ])('retries %s', (name) => {
    expect(isRetryableBedrockError(Object.assign(new Error('x'), { name }))).toBe(true);
  });

  it.each(['ValidationException', 'AccessDeniedException', 'AbortError'])(
    'does not retry %s',
    (name) => {
      expect(isRetryableBedrockError(Object.assign(new Error('x'), { name }))).toBe(false);
    },
  );
});
