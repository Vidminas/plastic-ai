import {
  agencySchema,
  AGENCY_TEXT_MAX,
  agencyGoalSchema,
  agencyIntentionsSchema,
  agencyReflectionSchema,
} from './agency';
import { configSchema } from './config';

describe('agencySchema', () => {
  it('leaves every feature off by default', () => {
    expect(agencySchema.parse({})).toEqual({
      intentions: false,
      conversationGoal: false,
      goalChecks: false,
      recap: false,
      reflections: false,
    });
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

describe('agencySchema goalSuggestions', () => {
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
