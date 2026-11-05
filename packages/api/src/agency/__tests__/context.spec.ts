import { DEFAULT_AGENCY_PROMPT } from 'librechat-data-provider';
import { withAgencyContext, resolveAgencyContext } from '../context';

const agency = {
  intentions: false,
  conversationGoal: true,
  recap: false,
  reflections: false,
};

const deps = (stored: string | null = null, template: string | null = null) => ({
  getConversationGoal: jest.fn().mockResolvedValue(stored == null ? null : { text: stored }),
  setConversationGoal: jest.fn().mockImplementation(async (_u, _c, text) => ({ text })),
  getAgencyPrompt: jest.fn().mockResolvedValue(template == null ? null : { template }),
  record: { event: jest.fn() },
});

describe('resolveAgencyContext', () => {
  const req = (goal?: string) => ({ config: { agency }, user: { id: 'u1' }, body: { goal } });

  it('is null while agency is off', async () => {
    const d = deps('stored');
    await expect(
      resolveAgencyContext({ config: {}, user: { id: 'u1' } }, 'c1', d),
    ).resolves.toBeNull();
    expect(d.getConversationGoal).not.toHaveBeenCalled();
  });

  it("saves a new conversation's goal once and records it", async () => {
    const d = deps();
    const text = await resolveAgencyContext(req('  plan my essay '), 'c1', d);
    expect(d.setConversationGoal).toHaveBeenCalledWith('u1', 'c1', 'plan my essay', undefined);
    expect(d.record.event).toHaveBeenCalledWith({
      userId: 'u1',
      conversationId: 'c1',
      type: 'goal_set',
      detail: 'plan my essay',
    });
    expect(text).toContain('plan my essay');
  });

  it('keeps the suggestion a first goal started from, when the config has it', async () => {
    const d = deps();
    const withSuggestions = { ...agency, goalSuggestions: [{ id: 'exams', title: 'Exams' }] };
    await resolveAgencyContext(
      {
        config: { agency: withSuggestions },
        user: { id: 'u1' },
        body: { goal: 'revise', goalSuggestionId: 'exams' },
      },
      'c1',
      d,
    );
    expect(d.setConversationGoal).toHaveBeenCalledWith('u1', 'c1', 'revise', 'exams');

    const unknown = deps();
    await resolveAgencyContext(
      {
        config: { agency: withSuggestions },
        user: { id: 'u1' },
        body: { goal: 'revise', goalSuggestionId: 'flying' },
      },
      'c1',
      unknown,
    );
    expect(unknown.setConversationGoal).toHaveBeenCalledWith('u1', 'c1', 'revise', undefined);
  });

  it('keeps the stored goal over one sent again', async () => {
    const d = deps('stored goal');
    const text = await resolveAgencyContext(req('another'), 'c1', d);
    expect(d.setConversationGoal).not.toHaveBeenCalled();
    expect(text).toContain('stored goal');
  });

  it('adds nothing, and reads nothing, without conversationGoal', async () => {
    const d = deps('stored');
    const text = await resolveAgencyContext(
      { config: { agency: { ...agency, conversationGoal: false } }, user: { id: 'u1' } },
      'c1',
      d,
    );
    expect(text).toBeNull();
    expect(d.getConversationGoal).not.toHaveBeenCalled();
    expect(d.getAgencyPrompt).not.toHaveBeenCalled();
  });

  it('adds the default instructions to a turn without a goal', async () => {
    const text = await resolveAgencyContext(req(), 'c1', deps());
    expect(text).toContain('"clarify"');
    expect(text).toContain('follow-up suggestions');
    expect(text).not.toContain('<conversation_goal>');
  });

  it("uses the learner's own template, with the goal", async () => {
    const d = deps('essay plan', 'Be brief.{{#goal}} Aim at: {{goal}}{{/goal}}');
    await expect(resolveAgencyContext(req(), 'c1', d)).resolves.toBe(
      'Be brief. Aim at: essay plan',
    );
  });

  it('adds nothing when the learner emptied the template', async () => {
    await expect(resolveAgencyContext(req(), 'c1', deps('g', ''))).resolves.toBeNull();
  });

  it('is null when the template leaves nothing for this turn', async () => {
    const d = deps(null, '{{#goal}}{{goal}}{{/goal}}');
    await expect(resolveAgencyContext(req(), 'c1', d)).resolves.toBeNull();
  });

  it('falls back to the default when the template cannot be read', async () => {
    const d = deps('g');
    d.getAgencyPrompt.mockRejectedValue(new Error('db down'));
    const text = await resolveAgencyContext(req(), 'c1', d);
    expect(text).toContain('"goal_check"');
    expect(DEFAULT_AGENCY_PROMPT).toContain('{{#goal}}');
  });

  it('starts from the configured instructions, unless the learner has their own', async () => {
    const promptTemplate = 'Study coach.{{#goal}} Goal: {{goal}}{{/goal}}';
    const configured = {
      config: { agency: { ...agency, promptTemplate } },
      user: { id: 'u1' },
      body: {},
    };
    const d = deps('Essay');
    await expect(resolveAgencyContext(configured, 'c1', d)).resolves.toBe(
      'Study coach. Goal: Essay',
    );
    d.getAgencyPrompt.mockRejectedValue(new Error('db down'));
    await expect(resolveAgencyContext(configured, 'c1', d)).resolves.toBe(
      'Study coach. Goal: Essay',
    );
    d.getAgencyPrompt.mockResolvedValue({ template: 'Mine.' });
    await expect(resolveAgencyContext(configured, 'c1', d)).resolves.toBe('Mine.');
  });

  it('reads the template and the goal together', async () => {
    const d = deps();
    let resolveGoal: (value: null) => void = () => undefined;
    d.getConversationGoal.mockReturnValue(new Promise((resolve) => (resolveGoal = resolve)));
    const pending = resolveAgencyContext(req(), 'c1', d);
    await Promise.resolve();
    expect(d.getAgencyPrompt).toHaveBeenCalledWith('u1');
    expect(d.getConversationGoal).toHaveBeenCalledWith('u1', 'c1');
    resolveGoal(null);
    await pending;
  });

  it('keeps a new goal in this turn even when saving it fails', async () => {
    const d = deps();
    d.setConversationGoal.mockRejectedValue(new Error('db down'));
    await expect(resolveAgencyContext(req('revise'), 'c1', d)).resolves.toContain('revise');
  });

  it('goes on without the goal when it cannot be read', async () => {
    const d = deps();
    d.getConversationGoal.mockRejectedValue(new Error('db down'));
    const text = await resolveAgencyContext(req('x'), 'c1', d);
    expect(text).not.toContain('<conversation_goal>');
    expect(text).toContain('"clarify"');
  });
});

describe('withAgencyContext', () => {
  it('appends the agency block to a resumed run’s context', () => {
    expect(withAgencyContext('files', 'goal')).toBe('files\n\ngoal');
    expect(withAgencyContext(undefined, 'goal')).toBe('goal');
    expect(withAgencyContext('files', null)).toBe('files');
    expect(withAgencyContext(undefined, null)).toBe('');
  });
});
