import { safeguardingSchema } from 'librechat-data-provider';
import type { GuardrailPolicyAssessment } from '../assess';
import { assessModelOutput } from '../output';

const levels = safeguardingSchema.parse({
  guardrail: { guardrailIdentifier: 'gr', guardrailVersion: '1' },
});

const streamed = (assessments: GuardrailPolicyAssessment[], stopReason = 'end_turn') => ({
  response_metadata: {
    messageStop: { stopReason },
    metadata: { trace: { guardrail: { outputAssessments: { gr: assessments } } } },
  },
});

describe('assessModelOutput', () => {
  it('flags filters below the blocking strength from the full trace', () => {
    const output = streamed([
      { contentPolicy: { filters: [{ type: 'VIOLENCE', confidence: 'MEDIUM', action: 'NONE' }] } },
      { contentPolicy: { filters: [{ type: 'VIOLENCE', confidence: 'LOW', action: 'NONE' }] } },
    ]);
    expect(assessModelOutput(output, levels)).toEqual({
      severity: 'flag',
      detections: [{ type: 'content', name: 'VIOLENCE', confidence: 'MEDIUM', severity: 'flag' }],
    });
  });

  it('blocks a response the guardrail stopped, naming what blocked it', () => {
    const output = streamed(
      [{ topicPolicy: { topics: [{ name: 'self-harm', action: 'BLOCKED', detected: true }] } }],
      'guardrail_intervened',
    );
    expect(assessModelOutput(output, levels)).toEqual({
      severity: 'block',
      detections: [{ type: 'topic', name: 'self-harm', severity: 'block' }],
    });
  });

  it('blocks a stopped response even when its trace names no filter', () => {
    expect(assessModelOutput(streamed([], 'guardrail_intervened'), levels)).toEqual({
      severity: 'block',
      detections: [],
    });
  });

  it("blocks a response the model's own filter stopped, keeping what the trace found", () => {
    const output = streamed(
      [{ contentPolicy: { filters: [{ type: 'INSULTS', confidence: 'MEDIUM', action: 'NONE' }] } }],
      'content_filtered',
    );
    expect(assessModelOutput(output, levels)).toEqual({
      severity: 'block',
      detections: [
        { type: 'content', name: 'INSULTS', confidence: 'MEDIUM', severity: 'flag' },
        { type: 'model', name: 'MODEL_FILTER', severity: 'block' },
      ],
    });
  });

  it('finds nothing in a response without guardrail metadata', () => {
    expect(assessModelOutput(undefined, levels).severity).toBe('none');
    expect(assessModelOutput({ response_metadata: {} }, levels).severity).toBe('none');
  });
});
