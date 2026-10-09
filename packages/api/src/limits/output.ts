import { EModelEndpoint } from 'librechat-data-provider';

/** Where client options carry the output budget; providers spell it differently. */
const TOP_LEVEL_KEYS = ['maxTokens', 'maxOutputTokens', 'max_tokens'] as const;
const MODEL_KWARGS_KEYS = ['max_completion_tokens', 'max_output_tokens', 'max_tokens'] as const;

type Options = Record<string, unknown>;

function isObject(value: unknown): value is Options {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function clampKeys(target: Options, keys: readonly string[], max: number): boolean {
  let found = false;
  for (const key of keys) {
    const value = target[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      found = true;
      if (value > max) {
        target[key] = max;
      }
    }
  }
  return found;
}

/** Sets the budget where the provider's client reads it when nothing asked for one. */
function setDefault(llmConfig: Options, provider: string | undefined, max: number): void {
  if (provider === EModelEndpoint.google || provider === 'vertexai') {
    llmConfig.maxOutputTokens = max;
    return;
  }
  if (provider === EModelEndpoint.openAI || provider === EModelEndpoint.azureOpenAI) {
    /** OpenAI's reasoning models reject `max_tokens`; every chat model accepts these. */
    const modelKwargs = isObject(llmConfig.modelKwargs) ? llmConfig.modelKwargs : {};
    const key = llmConfig.useResponsesApi === true ? 'max_output_tokens' : 'max_completion_tokens';
    modelKwargs[key] = max;
    llmConfig.modelKwargs = modelKwargs;
    return;
  }
  llmConfig.maxTokens = max;
}

/** Anthropic thinking must leave room for the answer inside the same budget. */
function fitThinkingBudget(thinking: unknown, max: number): void {
  if (isObject(thinking) && typeof thinking.budget_tokens === 'number') {
    if (thinking.budget_tokens >= max) {
      thinking.budget_tokens = Math.floor(max * 0.9);
    }
  }
}

/**
 * Caps a model's output budget at `max` tokens (`messageLimits.maxOutputTokens`), in place:
 * a larger requested budget is lowered, a smaller one kept, and a missing one set to `max`.
 */
export function capOutputTokens({
  llmConfig,
  provider,
  max,
}: {
  llmConfig: Options;
  provider: string | undefined;
  max: number | undefined;
}): void {
  if (max == null) {
    return;
  }
  const foundTopLevel = clampKeys(llmConfig, TOP_LEVEL_KEYS, max);
  const foundKwargs =
    isObject(llmConfig.modelKwargs) && clampKeys(llmConfig.modelKwargs, MODEL_KWARGS_KEYS, max);
  if (!foundTopLevel && !foundKwargs) {
    setDefault(llmConfig, provider, max);
  }
  fitThinkingBudget(llmConfig.thinking, max);
  if (isObject(llmConfig.additionalModelRequestFields)) {
    fitThinkingBudget(llmConfig.additionalModelRequestFields.thinking, max);
  }
}
