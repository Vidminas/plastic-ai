import { logger } from '@librechat/data-schemas';
import type {
  InferenceConfiguration,
  ConverseStreamOutput,
  BedrockRuntimeClient,
  ConverseStreamCommandInput,
  ConverseStreamCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';

/**
 * Errors Bedrock sends when it is busy or failed on its side, which another attempt can get
 * past. Validation, access and quota errors are left out: retrying cannot change them.
 */
const RETRYABLE_ERRORS = new Set([
  'ServiceUnavailableException',
  'ThrottlingException',
  'InternalServerException',
  'ModelStreamErrorException',
  'ModelNotReadyException',
]);

/** Defaults for `retry.baseDelayMs` and `retry.maxDelayMs`. */
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 8_000;

export const isRetryableBedrockError = (error: unknown): boolean =>
  error instanceof Error && RETRYABLE_ERRORS.has(error.name);

/**
 * Full jitter: anywhere from no wait to the attempt's ceiling, which starts at `baseDelayMs`
 * and doubles with each attempt, up to `maxDelayMs`.
 */
export const backoff =
  (baseDelayMs = DEFAULT_BASE_DELAY_MS, maxDelayMs = DEFAULT_MAX_DELAY_MS) =>
  (attempt: number): number =>
    Math.random() * Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));

/** Waits `ms`, or until `signal` aborts. */
const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
  });

type Stream = AsyncIterable<ConverseStreamOutput>;

/** The events already read, then the rest of the stream. */
async function* replay(
  held: ConverseStreamOutput[],
  iterator: AsyncIterator<ConverseStreamOutput>,
): Stream {
  yield* held;
  for (;;) {
    const next = await iterator.next();
    if (next.done === true) {
      return;
    }
    yield next.value;
  }
}

/**
 * Reads a stream up to its first event that carries content, which is where Bedrock reports a
 * busy service in a reply that has already started (`messageStart` says only who is speaking).
 * A failure here throws before anything reaches the learner, so the request can be sent again.
 */
async function prime(stream: Stream): Promise<Stream> {
  const iterator = stream[Symbol.asyncIterator]();
  const held: ConverseStreamOutput[] = [];
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) {
        return replay(held, iterator);
      }
      held.push(next.value);
      if (next.value.messageStart == null) {
        return replay(held, iterator);
      }
    }
  } catch (error) {
    await iterator.return?.().catch(() => undefined);
    throw error;
  }
}

/**
 * The model-specific parts of a reply's request, worked out for the fallback model, so it is
 * not sent settings (thinking, effort, betas, token limits) chosen for the model asked for.
 */
export type FallbackRequest = {
  additionalModelRequestFields?: ConverseStreamCommandInput['additionalModelRequestFields'];
  inferenceConfig?: Pick<InferenceConfiguration, 'maxTokens' | 'temperature' | 'topP'>;
};

/** The request for the fallback model: its id, and its own model-specific settings. */
function forFallback(
  input: ConverseStreamCommandInput,
  modelId: string,
  request: FallbackRequest,
): ConverseStreamCommandInput {
  const inferenceConfig = { ...input.inferenceConfig, ...request.inferenceConfig };
  return {
    ...input,
    modelId,
    additionalModelRequestFields: request.additionalModelRequestFields,
    inferenceConfig: Object.values(inferenceConfig).some((value) => value != null)
      ? inferenceConfig
      : undefined,
  };
}

/** The requests that produce a model's reply, the only ones a fallback model can serve. */
const REPLY_COMMANDS = new Set<string | undefined>(['ConverseCommand', 'ConverseStreamCommand']);

/**
 * Retries a Bedrock reply when Bedrock is busy or fails on its side.
 *
 * - A streamed reply (`ConverseStream`) that fails before any content has arrived is sent again,
 *   while the model's tries, counted with the SDK's own attempts, are under `maxAttempts`. The
 *   AWS SDK retries a request Bedrock turns away outright,
 *   but not an error inside a stream it has already accepted, which is how a busy model often
 *   answers. Once content has started, an error is passed on as before, since a second reply
 *   would repeat what was shown.
 * - With `fallbackModelId`, a reply (`Converse` or `ConverseStream`) that still fails with such
 *   an error once those tries are spent is sent to that model, with `fallbackRequest`'s
 *   settings and the same tries again.
 * - The wait between restarts ends early when the request's abort signal fires.
 */
export function retryBedrockReplies(
  client: BedrockRuntimeClient,
  {
    maxAttempts,
    fallbackModelId,
    fallbackRequest = {},
    delay = backoff(),
  }: {
    maxAttempts: number;
    fallbackModelId?: string;
    fallbackRequest?: FallbackRequest;
    delay?: (attempt: number) => number;
  },
): void {
  if (maxAttempts <= 1 && fallbackModelId == null) {
    return;
  }
  /** Each send's abort signal, by command, since middleware only sees the command. */
  const signals = new WeakMap<object, AbortSignal>();
  const send = client.send.bind(client);
  client.send = ((command: object, ...rest: Array<{ abortSignal?: AbortSignal } | undefined>) => {
    const signal = rest[0]?.abortSignal;
    if (signal != null) {
      signals.set(command, signal);
    }
    return (send as (...args: unknown[]) => Promise<unknown>)(command, ...rest);
  }) as typeof client.send;
  client.middlewareStack.add(
    (next, context) => {
      const streamed = context.commandName === 'ConverseStreamCommand';
      const command = context.__smithy_context?.commandInstance;
      const signal = command == null ? undefined : signals.get(command);
      /** One model's tries: the SDK's own, then stream restarts for a streamed reply. */
      const tries = async (args: Parameters<typeof next>[0]) => {
        if (!streamed) {
          return next(args);
        }
        /** Attempts so far, the SDK's own included, so restarts share one budget with them. */
        let used = 0;
        for (;;) {
          const result = await next(args);
          const output = result.output as ConverseStreamCommandOutput;
          used += output.$metadata?.attempts ?? 1;
          if (output.stream == null) {
            return result;
          }
          try {
            return { ...result, output: { ...output, stream: await prime(output.stream) } };
          } catch (error) {
            if (used >= maxAttempts || !isRetryableBedrockError(error) || signal?.aborted) {
              throw error;
            }
            logger.warn('[bedrock] Restarting a streamed reply Bedrock failed before it began', {
              error: (error as Error).name,
              attempt: used,
              maxAttempts,
            });
            await wait(delay(used), signal);
          }
        }
      };
      return async (args) => {
        if (!REPLY_COMMANDS.has(context.commandName)) {
          return next(args);
        }
        try {
          return await tries(args);
        } catch (error) {
          const { modelId } = args.input as { modelId?: string };
          if (
            fallbackModelId == null ||
            modelId === fallbackModelId ||
            !isRetryableBedrockError(error)
          ) {
            throw error;
          }
          logger.warn('[bedrock] Sending the reply to the fallback model', {
            error: (error as Error).name,
            modelId,
            fallbackModelId,
          });
          return tries({
            ...args,
            input: forFallback(
              /* Both reply commands take the same model fields. */
              args.input as ConverseStreamCommandInput,
              fallbackModelId,
              fallbackRequest,
            ),
          });
        }
      };
    },
    { step: 'initialize', name: 'librechatBedrockReplyRetry' },
  );
}
