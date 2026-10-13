import { buildGoalContext, withAgencyContext, resolveAgencyContext } from '../context';

const agency = { intentions: false, conversationGoal: true, goalChecks: true, recap: false };

const deps = (stored: string | null = null) => ({
  getConversationGoal: jest.fn().mockResolvedValue(stored == null ? null : { text: stored }),
  setConversationGoal: jest.fn().mockImplementation(async (_u, _c, text) => ({ text })),
  record: { event: jest.fn() },
});

describe('buildGoalContext', () => {
  it('adds nothing without a goal or goal checks', () => {
    expect(buildGoalContext({ goal: null, goalChecks: false })).toBeNull();
  });

  it('states the goal alone when goal checks are off', () => {
    const text = buildGoalContext({ goal: 'learn regression', goalChecks: false });
    expect(text).toContain('<conversation_goal>\nlearn regression\n</conversation_goal>');
    expect(text).not.toContain('ask_user_question');
  });

  it('asks for clarifying options, but no goal check, when there is no goal', () => {
    const text = buildGoalContext({ goal: null, goalChecks: true });
    expect(text).toContain('"clarify"');
    expect(text).not.toContain('"goal_check"');
  });

  it('adds the goal check with fixed option values when there is a goal', () => {
    const text = buildGoalContext({ goal: 'essay plan', goalChecks: true });
    for (const value of ['"goal_check"', '"continue"', '"refocus"', '"goal_changed"']) {
      expect(text).toContain(value);
    }
  });
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
    expect(d.setConversationGoal).toHaveBeenCalledWith('u1', 'c1', 'plan my essay');
    expect(d.record.event).toHaveBeenCalledWith({
      userId: 'u1',
      conversationId: 'c1',
      type: 'goal_set',
    });
    expect(text).toContain('plan my essay');
  });

  it('keeps the stored goal over one sent again', async () => {
    const d = deps('stored goal');
    const text = await resolveAgencyContext(req('another'), 'c1', d);
    expect(d.setConversationGoal).not.toHaveBeenCalled();
    expect(text).toContain('stored goal');
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
