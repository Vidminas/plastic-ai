import {
  agencySchema,
  AGENCY_SIGNALS_MAX,
  DEFAULT_AGENCY_SIGNALS,
  AGENCY_CLASSIFIER_PROMPT_MAX,
  AGENCY_TEXT_MAX,
  agencyGoalSchema,
  agencyIntentionsSchema,
  agencyReflectionSchema,
} from './agency';
import { AGENCY_PROMPT_MAX } from './agencyPrompt';
import { configSchema } from './config';

describe('agencySchema', () => {
  it('leaves every feature off by default', () => {
    expect(agencySchema.parse({})).toEqual({
      intentions: false,
      conversationGoal: false,
      recap: false,
      reflections: false,
    });
  });

  it('ignores the goalChecks switch older configs still have', () => {
    expect(agencySchema.parse({ goalChecks: true })).not.toHaveProperty('goalChecks');
  });

  it('is optional on the app config', () => {
    const base = { version: '1.0.0' };
    expect(configSchema.parse(base).agency).toBeUndefined();
    expect(configSchema.parse({ ...base, agency: { recap: true } }).agency?.recap).toBe(true);
  });
});

describe('agencyIntentionsSchema', () => {
  it('trims text and accepts ratings from 1 to 5 for known factors', () => {
    expect(
      agencyIntentionsSchema.parse({ goals: '  learn  ', factors: { guiding: 1, beyond: 5 } }),
    ).toEqual({
      goals: 'learn',
      intendedUse: '',
      commitments: '',
      factors: { guiding: 1, beyond: 5 },
    });
  });

  it.each([
    ['rating of 0', { factors: { guiding: 0 } }],
    ['fractional rating', { factors: { guiding: 2.5 } }],
    ['unknown factor', { factors: { unknown: 3 } }],
    ['field over the length limit', { goals: 'x'.repeat(AGENCY_TEXT_MAX + 1) }],
  ])('rejects a %s', (_label, input) => {
    expect(agencyIntentionsSchema.safeParse(input).success).toBe(false);
  });
});

describe('agencySchema promptTemplate', () => {
  it('needs none, and takes a template, or an empty one', () => {
    expect(agencySchema.parse({}).promptTemplate).toBeUndefined();
    expect(agencySchema.parse({ promptTemplate: ' Goal: {{goal}} ' }).promptTemplate).toBe(
      'Goal: {{goal}}',
    );
    expect(agencySchema.parse({ promptTemplate: '' }).promptTemplate).toBe('');
  });

  it('refuses a broken or oversized template, saying where it is broken', () => {
    const broken = agencySchema.safeParse({ promptTemplate: 'One\n{{#goal}} two' });
    expect(broken.success).toBe(false);
    expect(broken.error?.issues[0].message).toBe('unclosed_section at line 2: {{#goal}}');
    expect(
      agencySchema.safeParse({ promptTemplate: 'x'.repeat(AGENCY_PROMPT_MAX + 1) }).success,
    ).toBe(false);
  });
});

describe('agencySchema classifier prompts', () => {
  const classifier = { endpoint: 'bedrock', model: 'm' };

  it('takes either prompt, and needs neither', () => {
    expect(agencySchema.parse({ classifier }).classifier?.prompts).toBeUndefined();
    expect(
      agencySchema.parse({ classifier: { ...classifier, prompts: { signals: ' Spot these ' } } })
        .classifier?.prompts,
    ).toEqual({ signals: 'Spot these' });
  });

  it('refuses an empty or oversized prompt', () => {
    for (const topics of ['  ', 'x'.repeat(AGENCY_CLASSIFIER_PROMPT_MAX + 1)]) {
      expect(
        agencySchema.safeParse({ classifier: { ...classifier, prompts: { topics } } }).success,
      ).toBe(false);
    }
  });

  it('marks the default signs of agency unless given others', () => {
    const ids = agencySchema.parse({ classifier }).classifier?.signals.map(({ id }) => id);
    expect(ids).toEqual(DEFAULT_AGENCY_SIGNALS.map(({ id }) => id));
    expect(ids).toEqual(expect.arrayContaining(['reject', 'clarify', 'compare']));
    const signals = [{ id: 'own-words', label: 'Own words', definition: 'writes their own' }];
    expect(
      agencySchema.parse({ classifier: { ...classifier, signals } }).classifier?.signals,
    ).toEqual(signals);
  });

  it('refuses signs whose ids differ only by _ and -, which a reply reads alike', () => {
    const signals = ['study_plan', 'study-plan'].map((id) => ({
      id,
      label: id,
      definition: 'plans',
    }));
    expect(agencySchema.safeParse({ classifier: { ...classifier, signals } }).success).toBe(false);
  });

  it('refuses an empty, repeated or oversized list of signs, or one without a definition', () => {
    const signal = { id: 'a', label: 'A', definition: 'does a' };
    for (const signals of [
      [],
      [signal, signal],
      [{ id: 'a', label: 'A' }],
      Array.from({ length: AGENCY_SIGNALS_MAX + 1 }, (_, i) => ({ ...signal, id: `s${i}` })),
    ]) {
      expect(agencySchema.safeParse({ classifier: { ...classifier, signals } }).success).toBe(
        false,
      );
    }
  });
});

describe('agencySchema goalSuggestions and classifier', () => {
  const suggestion = { id: 'exams', title: 'Prepare for exams', icon: 'book' };

  it('takes suggestions with unique ids and known icons', () => {
    expect(agencySchema.parse({ goalSuggestions: [suggestion] }).goalSuggestions).toEqual([
      suggestion,
    ]);
    expect(agencySchema.safeParse({ goalSuggestions: [suggestion, suggestion] }).success).toBe(
      false,
    );
    expect(
      agencySchema.safeParse({ goalSuggestions: [{ ...suggestion, icon: 'rocket' }] }).success,
    ).toBe(false);
    expect(
      agencySchema.safeParse({ goalSuggestions: [{ ...suggestion, id: 'Exams!' }] }).success,
    ).toBe(false);
  });

  it('takes a classifier with topics, keeping other and unclassified reserved', () => {
    const classifier = { endpoint: 'bedrock', model: 'amazon.nova-lite-v1:0' };
    expect(agencySchema.parse({ classifier }).classifier?.topics).toEqual([]);
    expect(
      agencySchema.safeParse({
        classifier: { ...classifier, topics: [{ id: 'other', label: 'x' }] },
      }).success,
    ).toBe(false);
    expect(
      agencySchema.safeParse({
        classifier: {
          ...classifier,
          topics: [
            { id: 'maths', label: 'Maths' },
            { id: 'maths', label: 'Numbers' },
          ],
        },
      }).success,
    ).toBe(false);
  });
});

describe('agencyReflectionSchema', () => {
  it('fills skipped questions with empty answers', () => {
    expect(agencyReflectionSchema.parse({ answers: { working_on: ' My essay ' } })).toEqual({
      answers: { working_on: 'My essay', decision: '', reason: '', outcome: '', happy: '' },
    });
  });

  it('refuses a reflection with no answers, or an unknown question', () => {
    expect(agencyReflectionSchema.safeParse({ answers: { reason: '  ' } }).success).toBe(false);
    expect(
      agencyReflectionSchema.safeParse({ answers: { working_on: 'x', mood: 'ok' } }).success,
    ).toBe(false);
  });
});

describe('agencyGoalSchema', () => {
  it('takes the text and the suggestion it started from', () => {
    expect(agencyGoalSchema.parse({ text: ' Revise ', suggestionId: 'exams' })).toEqual({
      text: 'Revise',
      suggestionId: 'exams',
    });
    expect(agencyGoalSchema.parse({ text: 'Revise', suggestionId: null })).toEqual({
      text: 'Revise',
      suggestionId: null,
    });
    expect(agencyGoalSchema.safeParse({ text: '', suggestionId: 'exams' }).success).toBe(false);
    expect(agencyGoalSchema.safeParse({ text: 'x', suggestionId: 'Not An Id' }).success).toBe(
      false,
    );
  });
});
