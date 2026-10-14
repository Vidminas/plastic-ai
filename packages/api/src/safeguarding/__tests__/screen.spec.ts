import { safeguardingSchema } from 'librechat-data-provider';
import { ApplyGuardrailCommand } from '@aws-sdk/client-bedrock-runtime';
import { createSafeguardingScreener, getSafeguardingScreener } from '../screen';

const levels = safeguardingSchema.parse({
  guardrail: { guardrailIdentifier: 'gr', guardrailVersion: '1' },
});

const reply = (type: string, confidence: string) => ({
  action: 'NONE',
  assessments: [{ contentPolicy: { filters: [{ type, confidence, action: 'NONE' }] } }],
});

describe('createSafeguardingScreener', () => {
  it('sends the text as input with the full scope, and reads the confidences', async () => {
    const send = jest.fn().mockResolvedValue(reply('INSULTS', 'MEDIUM'));
    const screener = createSafeguardingScreener({
      client: { send } as never,
      guardrailIdentifier: 'gr',
      guardrailVersion: '3',
      levels,
    });

    await expect(screener.screen('you are rubbish')).resolves.toEqual({
      severity: 'flag',
      detections: [{ type: 'content', name: 'INSULTS', confidence: 'MEDIUM', severity: 'flag' }],
    });
    const command = send.mock.calls[0][0] as ApplyGuardrailCommand;
    expect(command).toBeInstanceOf(ApplyGuardrailCommand);
    expect(command.input).toEqual({
      guardrailIdentifier: 'gr',
      guardrailVersion: '3',
      source: 'INPUT',
      outputScope: 'FULL',
      content: [{ text: { text: 'you are rubbish' } }],
    });
  });

  it('screens long text in chunks and stops at the first blocked one', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce(reply('HATE', 'MEDIUM'))
      .mockResolvedValueOnce(reply('VIOLENCE', 'HIGH'))
      .mockResolvedValue(reply('HATE', 'NONE'));
    const screener = createSafeguardingScreener({
      client: { send } as never,
      guardrailIdentifier: 'gr',
      guardrailVersion: '1',
      levels,
    });

    const result = await screener.screen('word '.repeat(60_000));
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.severity).toBe('block');
    expect(result.detections.map(({ name }) => name)).toEqual(['HATE', 'VIOLENCE']);
  });

  it('lets a service failure through to the caller', async () => {
    const screener = createSafeguardingScreener({
      client: { send: jest.fn().mockRejectedValue(new Error('throttled')) } as never,
      guardrailIdentifier: 'gr',
      guardrailVersion: '1',
      levels,
    });
    await expect(screener.screen('hello')).rejects.toThrow('throttled');
  });
});

describe('getSafeguardingScreener', () => {
  it('refuses a guardrail whose environment variables are unset', () => {
    const config = safeguardingSchema.parse({
      guardrail: { guardrailIdentifier: '${UNSET_GUARDRAIL_ID}', guardrailVersion: '1' },
    });
    expect(() => getSafeguardingScreener(config, {})).toThrow(/guardrail ID or version/);
  });
});
