import { checkAgencyPrompt, renderAgencyPrompt, DEFAULT_AGENCY_PROMPT } from './agencyPrompt';

/** The hidden instructions before they could be edited, with goal checks on. */
const BEFORE_WITHOUT_GOAL = [
  'If a request is unclear or could reasonably mean quite different things, do not guess: call ask_user_question with one question whose id is "clarify" and 2 to 4 distinct options, then answer what the learner chooses.',
  'Otherwise just answer. Do not end replies with unprompted lists of follow-up suggestions.',
].join('\n\n');

const BEFORE_WITH_GOAL = (goal: string) =>
  [
    "The learner set this goal for the conversation. Keep your help aimed at it, in service of the learner's own thinking:",
    `<conversation_goal>\n${goal}\n</conversation_goal>`,
    'If a request is unclear or could reasonably mean quite different things, do not guess: call ask_user_question with one question whose id is "clarify" and 2 to 4 distinct options, then answer what the learner chooses.',
    'If a request works against the goal above, or drifts well away from it, first check with the learner: call ask_user_question with one question whose id is "goal_check", briefly saying how the request differs from the goal, with exactly these option values: "continue" (carry on with this request), "refocus" (go back to the goal), and "goal_changed" (the learner\'s goal has changed). Then follow their choice.',
    'Otherwise just answer. Do not end replies with unprompted lists of follow-up suggestions.',
  ].join('\n\n');

describe('renderAgencyPrompt', () => {
  it('gives the instructions as they were, without a goal', () => {
    expect(renderAgencyPrompt(DEFAULT_AGENCY_PROMPT, { goal: null })).toBe(BEFORE_WITHOUT_GOAL);
  });

  it('gives the instructions as they were, with a goal', () => {
    expect(renderAgencyPrompt(DEFAULT_AGENCY_PROMPT, { goal: 'essay plan' })).toBe(
      BEFORE_WITH_GOAL('essay plan'),
    );
  });

  it("keeps the learner's own blank lines, shrinking only those a removed section leaves", () => {
    expect(renderAgencyPrompt('A\n\n\n\nB\n\n{{#goal}}G{{/goal}}\n\nC', { goal: null })).toBe(
      'A\n\n\n\nB\n\nC',
    );
  });

  it('keeps blank lines inside the goal itself', () => {
    expect(renderAgencyPrompt('Goal: {{goal}}', { goal: 'a\n\n\n\nb' })).toBe('Goal: a\n\n\n\nb');
  });

  it('leaves out nested sections from the innermost out', () => {
    const template = '{{#goal}}A {{#goal}}B {{goal}}{{/goal}} C{{/goal}}D';
    expect(renderAgencyPrompt(template, { goal: 'g' })).toBe('A B g CD');
    expect(renderAgencyPrompt(template, { goal: null })).toBe('D');
  });

  it('is null when nothing is left', () => {
    expect(renderAgencyPrompt('{{#goal}}Only with a goal{{/goal}}', { goal: null })).toBeNull();
  });

  it('does not read tags the goal itself contains', () => {
    expect(renderAgencyPrompt('{{goal}}', { goal: '{{#goal}}x' })).toBe('{{#goal}}x');
  });
});

describe('checkAgencyPrompt', () => {
  it('accepts the default instructions', () => {
    expect(checkAgencyPrompt(DEFAULT_AGENCY_PROMPT)).toEqual({ ok: true });
  });

  it('accepts text without tags, and single braces such as masked placeholders', () => {
    expect(checkAgencyPrompt('Be brief. Write to {EMAIL} never.')).toEqual({ ok: true });
  });

  it('accepts an empty template, which adds nothing to a turn', () => {
    expect(checkAgencyPrompt('  \n ')).toEqual({ ok: true });
    expect(renderAgencyPrompt('', { goal: 'g' })).toBeNull();
  });

  it.each([
    ['{{#goal}}open', 'unclosed_section', '{{#goal}}', 1, 1],
    ['text\n {{/goal}}', 'unexpected_close', '{{/goal}}', 2, 2],
    ['{{gaol}}', 'unknown_variable', '{{gaol}}', 1, 1],
    ['{{ goal}}', 'malformed_tag', '{{ goal}}', 1, 1],
    ['{{}}', 'malformed_tag', '{{}}', 1, 1],
    ['a {{goal', 'malformed_tag', '{{goal', 1, 3],
  ])('reports %j as %s', (template, code, tag, line, column) => {
    expect(checkAgencyPrompt(template)).toEqual({
      ok: false,
      errors: [{ code, tag, line, column }],
    });
  });

  it('reports an unknown section where it opens and closes', () => {
    expect(checkAgencyPrompt('{{#goals}}x{{/goals}}')).toEqual({
      ok: false,
      errors: [
        { code: 'unknown_section', tag: '{{#goals}}', line: 1, column: 1 },
        { code: 'unknown_section', tag: '{{/goals}}', line: 1, column: 12 },
      ],
    });
  });

  it('names the section still open when a close does not match it', () => {
    const check = checkAgencyPrompt('{{#goal}}\n{{#goalx}}\n{{/goal}}');
    expect(check.ok).toBe(false);
    expect(!check.ok && check.errors).toEqual([
      { code: 'unknown_section', tag: '{{#goalx}}', line: 2, column: 1 },
      { code: 'mismatched_close', tag: '{{/goal}}', line: 3, column: 1, expected: 'goalx' },
    ]);
  });

  it('reports every mistake, in order', () => {
    const check = checkAgencyPrompt('{{/goal}} {{gaol}}\n{{#goal}}');
    expect(!check.ok && check.errors.map(({ code }) => code)).toEqual([
      'unexpected_close',
      'unknown_variable',
      'unclosed_section',
    ]);
  });

  it('accepts nested sections that close in order', () => {
    expect(checkAgencyPrompt('{{#goal}}a{{#goal}}b{{/goal}}c{{/goal}}')).toEqual({ ok: true });
  });
});
