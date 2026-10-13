import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { AppConfig } from '@librechat/data-schemas';
import { maskUserQuotes, maskUserText } from '../stored';

const EMAIL = /\S+@\S+\.\w+/g;

/** ApplyGuardrail as the sandbox guardrail answers: masks emails and reports them. */
const answer = async (command: { input: { content: Array<{ text: { text: string } }> } }) => {
  const text = command.input.content[0].text.text;
  const found = text.match(EMAIL) ?? [];
  return found.length === 0
    ? { action: 'NONE', outputs: [], assessments: [] }
    : {
        action: 'GUARDRAIL_INTERVENED',
        outputs: [{ text: text.replace(EMAIL, '{EMAIL}') }],
        assessments: [
          {
            sensitiveInformationPolicy: {
              piiEntities: found.map(() => ({
                type: 'EMAIL',
                action: 'ANONYMIZED',
                detected: true,
              })),
            },
          },
        ],
      };
};

let send: jest.SpyInstance;
beforeEach(() => {
  send = jest.spyOn(BedrockRuntimeClient.prototype, 'send').mockImplementation(answer as never);
});
afterEach(() => send.mockRestore());

const config = (piiMasking?: object) =>
  ({
    piiMasking: {
      guardrail: { guardrailIdentifier: 'gr-stored', guardrailVersion: '1' },
      ...piiMasking,
    },
  }) as AppConfig;

describe('maskUserText', () => {
  it('masks what a user writes before it is stored', async () => {
    expect(await maskUserText(config(), 'Write to sam@example.com')).toBe('Write to {EMAIL}');
  });

  it('leaves text alone when masking is not configured', async () => {
    expect(await maskUserText({} as AppConfig, 'sam@example.com')).toBe('sam@example.com');
    expect(await maskUserText(undefined, 'sam@example.com')).toBe('sam@example.com');
    expect(send).not.toHaveBeenCalled();
  });

  it('passes through values that are not text', async () => {
    expect(await maskUserText(config(), undefined)).toBeUndefined();
    expect(await maskUserText(config(), '')).toBe('');
  });

  it('masks each quoted excerpt', async () => {
    expect(await maskUserQuotes(config(), ['from sam@example.com', 'plain'])).toEqual([
      'from {EMAIL}',
      'plain',
    ]);
    expect(await maskUserQuotes(config(), null)).toBeNull();
  });
});
