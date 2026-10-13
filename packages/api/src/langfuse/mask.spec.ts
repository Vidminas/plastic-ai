import type { AppConfig } from '@librechat/data-schemas';
import { createGuardrailTraceMask } from './mask';

const maskEmail = jest.fn(async (text: string) => text.replace(/\S+@\S+\.\w+/g, '{EMAIL}'));

describe('createGuardrailTraceMask', () => {
  beforeEach(() => maskEmail.mockClear());

  it('masks every string inside serialized JSON, keeping keys and structure', async () => {
    const mask = createGuardrailTraceMask(maskEmail);
    const data = JSON.stringify({
      messages: [
        { role: 'user', content: 'Write to sam@example.com' },
        { role: 'assistant', content: 'Sure', tokens: 3 },
      ],
      'sam@example.com': true,
    });
    expect(JSON.parse((await mask({ data })) as string)).toEqual({
      messages: [
        { role: 'user', content: 'Write to {EMAIL}' },
        { role: 'assistant', content: 'Sure', tokens: 3 },
      ],
      'sam@example.com': true,
    });
  });

  it('masks each distinct string once per value', async () => {
    const mask = createGuardrailTraceMask(maskEmail);
    await mask({ data: JSON.stringify(['a@b.com hi', 'a@b.com hi', 'a@b.com hi']) });
    expect(maskEmail).toHaveBeenCalledTimes(1);
  });

  it('masks text that is not JSON, and JSON strings', async () => {
    const mask = createGuardrailTraceMask(maskEmail);
    expect(await mask({ data: 'Reach me at sam@example.com' })).toBe('Reach me at {EMAIL}');
    expect(await mask({ data: JSON.stringify('sam@example.com') })).toBe('"{EMAIL}"');
  });

  it('leaves numbers and booleans alone', async () => {
    const mask = createGuardrailTraceMask(maskEmail);
    expect(await mask({ data: '42' })).toBe('42');
    expect(await mask({ data: true })).toBe(true);
    expect(maskEmail).not.toHaveBeenCalled();
  });

  it('throws when masking fails, so Langfuse exports its placeholder instead', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('guardrail unavailable'));
    await expect(createGuardrailTraceMask(failing)({ data: 'text here' })).rejects.toThrow(
      'guardrail unavailable',
    );
  });
});

describe('buildLangfuseConfig trace masking', () => {
  const masking = {
    piiMasking: { guardrail: { guardrailIdentifier: 'gr1', guardrailVersion: '1' } },
  } as AppConfig;

  beforeEach(() => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    process.env.AWS_REGION = 'eu-west-2';
  });
  afterEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  it('masks traces with the piiMasking guardrail', async () => {
    const { buildLangfuseConfig } = await import('./config');
    const langfuse = buildLangfuseConfig({ appConfig: masking });
    expect(langfuse.mask).toBeInstanceOf(Function);
    expect(langfuse.enabled).not.toBe(false);
  });

  it('leaves traces as recorded without piiMasking', async () => {
    const { buildLangfuseConfig } = await import('./config');
    expect(buildLangfuseConfig({ appConfig: {} as AppConfig }).mask).toBeUndefined();
  });
});
