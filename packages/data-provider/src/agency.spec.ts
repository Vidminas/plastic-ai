import { agencySchema, agencyIntentionsSchema, AGENCY_TEXT_MAX } from './agency';
import { configSchema } from './config';

describe('agencySchema', () => {
  it('leaves every feature off by default', () => {
    expect(agencySchema.parse({})).toEqual({
      intentions: false,
      conversationGoal: false,
      goalChecks: false,
      recap: false,
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
