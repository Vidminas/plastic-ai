import { safeguardingSchema } from 'librechat-data-provider';
import { assessGuardrail, mergeAssessments, blockedReasons } from '../assess';

const levels = safeguardingSchema.parse({
  guardrail: { guardrailIdentifier: 'gr', guardrailVersion: '1' },
  block: { PROMPT_ATTACK: 'MEDIUM', SEXUAL: 'OFF' },
  topics: { 'self-harm': 'block' },
});

const content = (type: string, confidence: string, action = 'NONE') => ({
  contentPolicy: { filters: [{ type, confidence, action, detected: confidence !== 'NONE' }] },
});

describe('assessGuardrail', () => {
  it('flags at MEDIUM and blocks at HIGH by default', () => {
    expect(assessGuardrail([content('VIOLENCE', 'LOW')], levels).severity).toBe('none');
    expect(assessGuardrail([content('VIOLENCE', 'MEDIUM')], levels)).toEqual({
      severity: 'flag',
      detections: [{ type: 'content', name: 'VIOLENCE', confidence: 'MEDIUM', severity: 'flag' }],
    });
    expect(assessGuardrail([content('VIOLENCE', 'HIGH')], levels).severity).toBe('block');
  });

  it('follows per-filter levels, and OFF never blocks', () => {
    expect(assessGuardrail([content('PROMPT_ATTACK', 'MEDIUM')], levels).severity).toBe('block');
    expect(assessGuardrail([content('SEXUAL', 'HIGH')], levels).severity).toBe('flag');
  });

  it('blocks whatever Bedrock blocked, even below the levels', () => {
    expect(assessGuardrail([content('SEXUAL', 'HIGH', 'BLOCKED')], levels).severity).toBe('block');
  });

  it('gives topics their configured action, flag when unlisted, block when blocked', () => {
    const topic = (name: string, action = 'NONE', detected = true) => ({
      topicPolicy: { topics: [{ name, type: 'DENY', action, detected }] },
    });
    expect(assessGuardrail([topic('self-harm')], levels).severity).toBe('block');
    expect(assessGuardrail([topic('bullying')], levels).severity).toBe('flag');
    expect(assessGuardrail([topic('bullying', 'BLOCKED')], levels).severity).toBe('block');
    expect(assessGuardrail([topic('bullying', 'NONE', false)], levels).severity).toBe('none');
  });

  it('flags word list matches without naming the word, unless words are off', () => {
    const words = {
      wordPolicy: {
        customWords: [{ match: 'secretword', action: 'NONE', detected: true }],
        managedWordLists: [{ match: 'other', type: 'PROFANITY', action: 'NONE', detected: true }],
      },
    };
    const assessed = assessGuardrail([words], levels);
    expect(assessed).toEqual({
      severity: 'flag',
      detections: [
        { type: 'word', name: 'custom', severity: 'flag' },
        { type: 'word', name: 'PROFANITY', severity: 'flag' },
      ],
    });
    expect(JSON.stringify(assessed)).not.toContain('secretword');
    expect(assessGuardrail([words], { ...levels, words: 'off' }).severity).toBe('none');
  });

  it('keeps each filter once, at its worst', () => {
    const assessed = assessGuardrail(
      [content('HATE', 'MEDIUM'), content('HATE', 'HIGH'), content('HATE', 'LOW')],
      levels,
    );
    expect(assessed.detections).toEqual([
      { type: 'content', name: 'HATE', confidence: 'HIGH', severity: 'block' },
    ]);
  });
});

describe('mergeAssessments and blockedReasons', () => {
  it('combines chunks and names only the blocking content and topic filters', () => {
    const merged = mergeAssessments([
      assessGuardrail([content('INSULTS', 'MEDIUM')], levels),
      assessGuardrail(
        [
          content('VIOLENCE', 'HIGH'),
          { wordPolicy: { customWords: [{ detected: true }] } },
          { topicPolicy: { topics: [{ name: 'self-harm', detected: true }] } },
        ],
        levels,
      ),
    ]);
    expect(merged.severity).toBe('block');
    expect(blockedReasons(merged)).toEqual([
      { type: 'content', name: 'VIOLENCE' },
      { type: 'topic', name: 'self-harm' },
    ]);
  });
});
