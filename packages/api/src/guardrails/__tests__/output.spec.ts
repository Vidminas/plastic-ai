import { logger } from '@librechat/data-schemas';
import { reportGuardrailOutputDetections } from '../output';

/** An output assessment as a streamed Converse call reports it, one per checked chunk. */
const assessment = (...entities: Array<[string, boolean?]>) => ({
  sensitiveInformationPolicy: {
    piiEntities: entities.map(([type, detected = true]) => ({
      match: 'sam@example.com',
      type,
      action: 'NONE',
      detected,
    })),
  },
  invocationMetrics: { guardrailProcessingLatency: 120 },
});

const ids = { messageId: 'm1', conversationId: 'c1' };

describe('reportGuardrailOutputDetections', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  });

  it('logs the types detected in a streamed response, and removes the trace with its matches', () => {
    const output = {
      content: 'Write to sam@example.com',
      response_metadata: {
        metadata: {
          usage: { inputTokens: 10 },
          trace: {
            guardrail: {
              inputAssessment: {},
              outputAssessments: {
                gr1: [
                  assessment(),
                  assessment(['EMAIL'], ['PHONE', false]),
                  {
                    sensitiveInformationPolicy: {
                      regexes: [
                        { name: 'UK_POSTCODE', match: 'N1 9GU', action: 'NONE', detected: true },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    };
    expect(reportGuardrailOutputDetections(output, ids)).toEqual(['EMAIL', 'UK_POSTCODE']);
    expect(warn).toHaveBeenCalledWith(
      '[piiMasking] A model response contains personal identifiers',
      {
        ...ids,
        identifiers: ['EMAIL', 'UK_POSTCODE'],
      },
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sam@example.com');
    expect(output.response_metadata.metadata).toEqual({ usage: { inputTokens: 10 } });
    expect(output.content).toBe('Write to sam@example.com');
  });

  it('reads the trace of a call that was not streamed', () => {
    const output = {
      response_metadata: {
        stopReason: 'end_turn',
        trace: {
          guardrail: { outputAssessments: { gr1: [assessment(['UK_NATIONAL_INSURANCE_NUMBER'])] } },
        },
      },
    };
    expect(reportGuardrailOutputDetections(output, ids)).toEqual(['UK_NATIONAL_INSURANCE_NUMBER']);
    expect(output.response_metadata).toEqual({ stopReason: 'end_turn' });
  });

  it('logs nothing for a clean response, or one without a guardrail trace', () => {
    const clean = {
      response_metadata: {
        metadata: { trace: { guardrail: { outputAssessments: { gr1: [assessment()] } } } },
      },
    };
    expect(reportGuardrailOutputDetections(clean, ids)).toEqual([]);
    expect(reportGuardrailOutputDetections({ response_metadata: {} }, ids)).toEqual([]);
    expect(reportGuardrailOutputDetections(undefined, ids)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(clean.response_metadata.metadata).toEqual({});
  });
});
