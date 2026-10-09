import { EModelEndpoint } from 'librechat-data-provider';
import { capOutputTokens } from './output';

describe('capOutputTokens', () => {
  it('leaves the config alone without a limit', () => {
    const llmConfig = { maxTokens: 64_000 };
    capOutputTokens({ llmConfig, provider: EModelEndpoint.bedrock, max: undefined });
    expect(llmConfig).toEqual({ maxTokens: 64_000 });
  });

  it('lowers a larger requested budget and keeps a smaller one', () => {
    const large = { maxTokens: 64_000, maxOutputTokens: 64_000 };
    capOutputTokens({ llmConfig: large, provider: EModelEndpoint.bedrock, max: 8192 });
    expect(large).toEqual({ maxTokens: 8192, maxOutputTokens: 8192 });

    const small = { maxTokens: 1000 };
    capOutputTokens({ llmConfig: small, provider: EModelEndpoint.bedrock, max: 8192 });
    expect(small).toEqual({ maxTokens: 1000 });
  });

  it('clamps budgets carried in modelKwargs', () => {
    const llmConfig = { modelKwargs: { max_completion_tokens: 50_000 } };
    capOutputTokens({ llmConfig, provider: EModelEndpoint.openAI, max: 8192 });
    expect(llmConfig).toEqual({ modelKwargs: { max_completion_tokens: 8192 } });
  });

  it('sets the budget where each provider reads it when none was requested', () => {
    const bedrock: Record<string, unknown> = {};
    capOutputTokens({ llmConfig: bedrock, provider: EModelEndpoint.bedrock, max: 8192 });
    expect(bedrock).toEqual({ maxTokens: 8192 });

    const google: Record<string, unknown> = {};
    capOutputTokens({ llmConfig: google, provider: EModelEndpoint.google, max: 8192 });
    expect(google).toEqual({ maxOutputTokens: 8192 });

    const openAI: Record<string, unknown> = { modelKwargs: { reasoning_effort: 'low' } };
    capOutputTokens({ llmConfig: openAI, provider: EModelEndpoint.openAI, max: 8192 });
    expect(openAI).toEqual({
      modelKwargs: { reasoning_effort: 'low', max_completion_tokens: 8192 },
    });

    const responses: Record<string, unknown> = { useResponsesApi: true };
    capOutputTokens({ llmConfig: responses, provider: EModelEndpoint.openAI, max: 8192 });
    expect(responses).toEqual({ useResponsesApi: true, modelKwargs: { max_output_tokens: 8192 } });

    const custom: Record<string, unknown> = {};
    capOutputTokens({ llmConfig: custom, provider: 'ollama', max: 8192 });
    expect(custom).toEqual({ maxTokens: 8192 });
  });

  it('keeps an Anthropic thinking budget inside the capped output budget', () => {
    const anthropic = { maxTokens: 64_000, thinking: { type: 'enabled', budget_tokens: 32_000 } };
    capOutputTokens({ llmConfig: anthropic, provider: EModelEndpoint.anthropic, max: 8192 });
    expect(anthropic).toEqual({
      maxTokens: 8192,
      thinking: { type: 'enabled', budget_tokens: 7372 },
    });

    const bedrock = {
      maxTokens: 64_000,
      additionalModelRequestFields: { thinking: { type: 'enabled', budget_tokens: 2000 } },
    };
    capOutputTokens({ llmConfig: bedrock, provider: EModelEndpoint.bedrock, max: 8192 });
    expect(bedrock.additionalModelRequestFields.thinking.budget_tokens).toBe(2000);
  });
});
