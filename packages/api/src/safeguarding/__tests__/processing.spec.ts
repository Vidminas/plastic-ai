import { logger } from '@librechat/data-schemas';
import { safeguardingSchema } from 'librechat-data-provider';
import type { SafeguardingAssessment } from '../assess';
import { reportGuardrailOutputDetections } from '~/guardrails/output';
import { createGuardrailTextMasker } from '~/guardrails/mask';
import { createSafeguardingReporter } from '../record';
import { screenForSafeguarding } from '../service';
import { recordProcessing } from '../sink';
import * as screen from '../screen';

jest.mock('../sink', () => ({
  ...jest.requireActual('../sink'),
  recordProcessing: jest.fn(),
}));

const record = recordProcessing as jest.Mock;
const participant = { userId: 'u1', studyId: 'sub-1' };
const blocked: SafeguardingAssessment = {
  severity: 'block',
  detections: [{ type: 'content', name: 'VIOLENCE', confidence: 'HIGH', severity: 'block' }],
};
const secret = 'write to sam@example.com please';

beforeEach(() => {
  record.mockClear();
  jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  jest.spyOn(logger, 'error').mockImplementation(() => logger);
});
afterEach(() => jest.restoreAllMocks());

/** Whatever is recorded, the text it was about is not in it. */
const expectNoContent = () =>
  expect(JSON.stringify(record.mock.calls)).not.toContain('sam@example.com');

describe('safeguarding screening', () => {
  const appConfig = {
    safeguarding: safeguardingSchema.parse({
      guardrail: { guardrailIdentifier: 'gr', guardrailVersion: '1' },
    }),
  } as never;
  const screened = (result: SafeguardingAssessment | Error) =>
    jest.spyOn(screen, 'getSafeguardingScreener').mockReturnValue({
      screen:
        result instanceof Error
          ? jest.fn().mockRejectedValue(result)
          : jest.fn().mockResolvedValue(result),
    });
  const run = (source: 'prompt' | 'upload') =>
    screenForSafeguarding({
      appConfig,
      text: secret,
      event: { source, participant, conversationId: 'c1', messageId: 'm1' },
    });

  it('records clean text too, so it differs from text never screened', async () => {
    screened({ severity: 'none', detections: [] });
    await run('prompt');
    expect(record).toHaveBeenCalledWith(
      'safeguard_screen',
      expect.objectContaining({
        outcome: 'none',
        source: 'prompt',
        userId: 'u1',
        conversationId: 'c1',
        messageId: 'm1',
        durationMs: expect.any(Number),
      }),
    );
    expectNoContent();
  });

  it('records a block and a failure to screen', async () => {
    screened(blocked);
    await run('prompt');
    screened(new Error('down'));
    await run('prompt');
    expect(record.mock.calls.map(([, { outcome }]) => outcome)).toEqual(['block', 'error']);
  });

  it('leaves an upload to its outcome', async () => {
    screened({ severity: 'none', detections: [] });
    await run('upload');
    expect(record).not.toHaveBeenCalled();
  });
});

describe('PII masking', () => {
  const masker = (send: jest.Mock) =>
    createGuardrailTextMasker({
      client: { send },
      guardrailIdentifier: 'gr',
      guardrailVersion: '1',
    });

  it('records a real call once, not the answers from the cache', async () => {
    const maskText = masker(
      jest.fn().mockResolvedValue({
        action: 'GUARDRAIL_INTERVENED',
        outputs: [{ text: 'write to {EMAIL} please' }],
      }),
    );
    await maskText(secret);
    await maskText(secret);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      'pii_mask',
      expect.objectContaining({ outcome: 'masked', calls: 1, chars: secret.length }),
    );
    expectNoContent();
  });

  it('records a failure', async () => {
    await expect(masker(jest.fn().mockRejectedValue(new Error('down')))(secret)).rejects.toThrow();
    expect(record).toHaveBeenCalledWith('pii_mask', expect.objectContaining({ outcome: 'error' }));
  });
});

describe('the output guardrail', () => {
  const output = (trace: unknown) => ({ response_metadata: { trace } }) as never;
  const ids = { conversationId: 'c1', messageId: 'm1' };

  it('records a clean response and one with identifiers, by type only', () => {
    reportGuardrailOutputDetections(output({ guardrail: {} }), ids);
    reportGuardrailOutputDetections(
      output({
        guardrail: {
          outputAssessments: {
            gr: [
              {
                sensitiveInformationPolicy: {
                  piiEntities: [{ type: 'EMAIL', match: 'sam@example.com', detected: true }],
                },
              },
            ],
          },
        },
      }),
      ids,
    );
    expect(record).toHaveBeenNthCalledWith(1, 'output_guardrail', {
      ...ids,
      outcome: 'clean',
      identifiers: '',
    });
    expect(record).toHaveBeenNthCalledWith(2, 'output_guardrail', {
      ...ids,
      outcome: 'identifiers',
      identifiers: 'EMAIL',
    });
    expectNoContent();
  });

  it('records nothing when the guardrail did not run', () => {
    reportGuardrailOutputDetections(output(undefined), ids);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('safeguarding alerts', () => {
  const event = { source: 'prompt' as const, participant, conversationId: 'c1', messageId: 'm1' };

  it.each([
    ['sent', jest.fn().mockResolvedValue(undefined)],
    ['error', jest.fn().mockRejectedValue(new Error('denied'))],
  ])('records an alert as %s', async (outcome, publish) => {
    await createSafeguardingReporter({ alerts: { publish } }).report(blocked, event);
    expect(record).toHaveBeenCalledWith(
      'safeguarding_alert',
      expect.objectContaining({ outcome, userId: 'u1', conversationId: 'c1' }),
    );
  });
});
