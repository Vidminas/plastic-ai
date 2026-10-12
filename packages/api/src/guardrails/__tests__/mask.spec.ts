import type { AppConfig } from '@librechat/data-schemas';
import { createGuardrailTextMasker, getGuardrailTextMasker } from '../mask';

/** An ApplyGuardrail response that masks what `mask` rewrites, or leaves the text alone. */
const guardrail = (mask: (text: string) => string = (text) => text) =>
  jest.fn(async (command: { input: { content: Array<{ text: { text: string } }> } }) => {
    const text = command.input.content[0].text.text;
    const masked = mask(text);
    return masked === text
      ? { action: 'NONE', outputs: [] }
      : { action: 'GUARDRAIL_INTERVENED', outputs: [{ text: masked }] };
  });

const maskEmail = (text: string) => text.replace(/\S+@\S+/g, '{EMAIL}');

describe('createGuardrailTextMasker', () => {
  const make = (send: jest.Mock, cacheSize?: number) =>
    createGuardrailTextMasker({
      client: { send },
      guardrailIdentifier: 'gr1',
      guardrailVersion: '2',
      cacheSize,
    });

  it('returns the masked text when the guardrail intervenes, as an input', async () => {
    const send = guardrail(maskEmail);
    expect(await make(send)('Write to sam@example.com')).toBe('Write to {EMAIL}');
    expect(send.mock.calls[0][0].input).toEqual({
      guardrailIdentifier: 'gr1',
      guardrailVersion: '2',
      source: 'INPUT',
      content: [{ text: { text: 'Write to sam@example.com' } }],
    });
  });

  it('returns the text unchanged when the guardrail finds nothing', async () => {
    expect(await make(guardrail())('Nothing personal')).toBe('Nothing personal');
  });

  it('does not send strings too short to hold an identifier', async () => {
    const send = guardrail();
    expect(await make(send)(' ok ')).toBe(' ok ');
    expect(send).not.toHaveBeenCalled();
  });

  it('masks each distinct text once, sharing a request already in flight', async () => {
    const send = guardrail(maskEmail);
    const maskText = make(send);
    const [first, second] = await Promise.all([
      maskText('Email sam@example.com'),
      maskText('Email sam@example.com'),
    ]);
    expect(await maskText('Email sam@example.com')).toBe('Email {EMAIL}');
    expect([first, second]).toEqual(['Email {EMAIL}', 'Email {EMAIL}']);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('treats text it has masked as already masked, so a stored copy costs no call', async () => {
    const send = guardrail(maskEmail);
    const maskText = make(send);
    expect(await maskText('Email sam@example.com')).toBe('Email {EMAIL}');
    expect(await maskText('Email {EMAIL}')).toBe('Email {EMAIL}');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('forgets the least recently used text beyond its cache size', async () => {
    const send = guardrail();
    const maskText = make(send, 2);
    await maskText('first text');
    await maskText('second text');
    await maskText('first text');
    await maskText('third text');
    await maskText('first text');
    await maskText('second text');
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('masks text longer than one request takes in pieces, and joins them back', async () => {
    const send = guardrail(maskEmail);
    const text = `${'word '.repeat(30_000)}sam@example.com ${'word '.repeat(10_000)}`;
    const masked = await make(send)(text);
    expect(masked).toBe(text.replace('sam@example.com', '{EMAIL}'));
    expect(send.mock.calls.length).toBeGreaterThan(1);
    for (const [command] of send.mock.calls) {
      expect(command.input.content[0].text.text.length).toBeLessThanOrEqual(100_000);
    }
  });

  it('throws when the guardrail cannot be reached, and tries again next time', async () => {
    const send = guardrail(maskEmail);
    send.mockRejectedValueOnce(new Error('ThrottlingException'));
    const maskText = make(send);
    await expect(maskText('Email sam@example.com')).rejects.toThrow('ThrottlingException');
    expect(await maskText('Email sam@example.com')).toBe('Email {EMAIL}');
  });
});

describe('getGuardrailTextMasker', () => {
  const appConfig = (guardrail?: { guardrailIdentifier: string; guardrailVersion: string }) =>
    (guardrail ? { piiMasking: { guardrail } } : {}) as AppConfig;

  it('has nothing to mask with when no guardrail is configured', () => {
    expect(getGuardrailTextMasker(undefined)).toBeUndefined();
    expect(getGuardrailTextMasker(appConfig())).toBeUndefined();
  });

  it('resolves the guardrail from environment references and shares one masker', () => {
    process.env.TEST_GUARDRAIL_ID = 'gr1';
    const config = appConfig({
      guardrailIdentifier: '${TEST_GUARDRAIL_ID}',
      guardrailVersion: '3',
    });
    const env = { AWS_REGION: 'eu-west-2' } as NodeJS.ProcessEnv;
    const first = getGuardrailTextMasker(config, env);
    expect(first).toBeInstanceOf(Function);
    expect(getGuardrailTextMasker(config, env)).toBe(first);
    delete process.env.TEST_GUARDRAIL_ID;
  });

  it('ignores the guardrail on Bedrock model calls, which masking does not use', () => {
    const config = {
      endpoints: {
        bedrock: { guardrailConfig: { guardrailIdentifier: 'gr1', guardrailVersion: '1' } },
      },
    } as unknown as AppConfig;
    expect(getGuardrailTextMasker(config)).toBeUndefined();
  });

  it('has nothing to mask with when an environment reference is unset', () => {
    const config = appConfig({
      guardrailIdentifier: '${UNSET_GUARDRAIL_ID}',
      guardrailVersion: '1',
    });
    expect(getGuardrailTextMasker(config)).toBeUndefined();
  });
});
