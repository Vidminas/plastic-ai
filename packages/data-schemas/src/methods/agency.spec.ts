import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createAgencyMethods, type AgencyMethods } from './agency';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: AgencyMethods;

const userId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();

const blank = { working_on: '', decision: '', reason: '', outcome: '', happy: '' };

const intentions = {
  goals: 'Get confident with statistics',
  intendedUse: 'Explore options',
  commitments: 'No graded work',
  factors: { guiding: 4, reflecting: 5 },
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  methods = createAgencyMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all(
    ['AgencyIntentions', 'AgencyGoal', 'AgencyEvent', 'AgencyReflection', 'Conversation'].map(
      (name) => mongoose.models[name].deleteMany({}),
    ),
  );
});

describe('agency intentions', () => {
  it('is absent until set, then replaced on each save', async () => {
    await expect(methods.getAgencyIntentions(userId)).resolves.toBeNull();

    await methods.setAgencyIntentions(userId, intentions);
    const saved = await methods.setAgencyIntentions(userId, {
      ...intentions,
      goals: 'Write better essays',
      factors: { checking: 3 },
    });

    expect(saved).toMatchObject({ goals: 'Write better essays', factors: { checking: 3 } });
    expect(saved.factors).not.toHaveProperty('guiding');
    expect(saved.updatedAt).toEqual(expect.any(String));
    await expect(methods.getAgencyIntentions(otherUserId)).resolves.toBeNull();
  });

  it('rejects a factor rating outside 1 to 5', async () => {
    await expect(
      methods.setAgencyIntentions(userId, { ...intentions, factors: { guiding: 6 } }),
    ).rejects.toThrow();
  });
});

describe('conversation goals', () => {
  it('keeps one goal per conversation and user', async () => {
    await methods.setConversationGoal(userId, 'c1', 'first');
    await methods.setConversationGoal(userId, 'c1', 'second');

    await expect(methods.getConversationGoal(userId, 'c1')).resolves.toMatchObject({
      text: 'second',
    });
    await expect(methods.getConversationGoal(otherUserId, 'c1')).resolves.toBeNull();
  });

  it('deletes the goals of the named conversations only', async () => {
    await methods.setConversationGoal(userId, 'c1', 'one');
    await methods.setConversationGoal(userId, 'c2', 'two');
    await methods.setConversationGoal(otherUserId, 'c1', 'theirs');

    await expect(methods.deleteConversationGoals(userId, ['c1'])).resolves.toBe(1);
    await expect(methods.getConversationGoal(userId, 'c2')).resolves.not.toBeNull();
    await expect(methods.getConversationGoal(otherUserId, 'c1')).resolves.not.toBeNull();
  });
});

describe('conversation goals from a suggestion', () => {
  it('keeps the suggestion with the text, until it is dropped', async () => {
    await methods.setConversationGoal(userId, 'c1', 'Revise algebra', 'exams');
    await expect(methods.getConversationGoal(userId, 'c1')).resolves.toMatchObject({
      text: 'Revise algebra',
      suggestionId: 'exams',
    });
    /** Text alone keeps the suggestion; null drops it. */
    await methods.setConversationGoal(userId, 'c1', 'Revise geometry');
    await expect(methods.getConversationGoal(userId, 'c1')).resolves.toMatchObject({
      suggestionId: 'exams',
    });
    await methods.setConversationGoal(userId, 'c1', 'Something else', null);
    await expect(methods.getConversationGoal(userId, 'c1')).resolves.not.toHaveProperty(
      'suggestionId',
    );
  });
});

describe('getAgencyRecap', () => {
  it('counts engagement and returns the latest examples, for this user only', async () => {
    await mongoose.models.Conversation.create([
      { conversationId: 'c1', user: String(userId), endpoint: 'bedrock' },
      { conversationId: 'c2', user: String(userId), endpoint: 'bedrock' },
      { conversationId: 'c3', user: String(otherUserId), endpoint: 'bedrock' },
    ]);
    await methods.setConversationGoal(userId, 'c1', 'learn regression');
    for (const event of [
      { type: 'options_offered', conversationId: 'c2' },
      { type: 'options_offered', conversationId: 'c2' },
      { type: 'option_selected', conversationId: 'c2', messageId: 'm1', detail: 'A plan' },
      { type: 'goal_check_offered', conversationId: 'c1' },
      { type: 'goal_check_resolved', conversationId: 'c1', messageId: 'm2', detail: 'refocus' },
    ] as const) {
      await methods.recordAgencyEvent({ userId, ...event });
    }
    await methods.recordAgencyEvent({ userId: otherUserId, type: 'option_selected' });

    const recap = await methods.getAgencyRecap(userId);

    expect(recap.goals).toEqual({ set: 1, conversations: 2 });
    expect(recap.options).toEqual({ selected: 1, offered: 2 });
    expect(recap.goalChecks).toEqual({ offered: 1, continue: 0, refocus: 1, goal_changed: 0 });
    expect(recap.examples.goal).toMatchObject({ conversationId: 'c1', detail: 'learn regression' });
    expect(recap.examples.option).toMatchObject({ messageId: 'm1', detail: 'A plan' });
    expect(recap.examples.goalCheck).toMatchObject({ messageId: 'm2' });
  });

  it('scopes counts to one conversation', async () => {
    await methods.recordAgencyEvent({ userId, type: 'options_offered', conversationId: 'c1' });
    await methods.recordAgencyEvent({ userId, type: 'options_offered', conversationId: 'c2' });

    const recap = await methods.getAgencyRecap(userId, { conversationId: 'c1' });
    expect(recap.options.offered).toBe(1);
    expect(recap.goals).toEqual({ set: 0, conversations: 1 });
  });
});

describe('deleteAgencyData', () => {
  it("removes the user's intentions, goals and events, and nobody else's", async () => {
    await methods.setAgencyIntentions(userId, intentions);
    await methods.setConversationGoal(userId, 'c1', 'mine');
    await methods.setConversationGoal(otherUserId, 'c1', 'theirs');
    await methods.recordAgencyEvent({ userId, type: 'recap_viewed' });

    await methods.deleteAgencyData(userId);

    await expect(methods.getAgencyIntentions(userId)).resolves.toBeNull();
    await expect(methods.getConversationGoal(userId, 'c1')).resolves.toBeNull();
    await expect(methods.getConversationGoal(otherUserId, 'c1')).resolves.not.toBeNull();
    await expect(mongoose.models.AgencyEvent.countDocuments({ userId })).resolves.toBe(0);
  });
});

describe('deleting conversations', () => {
  it('removes their goals and events, and keeps the rest', async () => {
    const { createMethods } = await import('./index');
    const { deleteConvos } = createMethods(mongoose);
    await mongoose.models.Conversation.create([
      { conversationId: 'c1', user: String(userId), endpoint: 'bedrock' },
      { conversationId: 'c2', user: String(userId), endpoint: 'bedrock' },
    ]);
    await methods.setConversationGoal(userId, 'c1', 'gone');
    await methods.setConversationGoal(userId, 'c2', 'kept');
    await methods.recordAgencyEvent({ userId, type: 'options_offered', conversationId: 'c1' });
    await methods.recordAgencyEvent({ userId, type: 'recap_viewed' });

    await deleteConvos(String(userId), { conversationId: 'c1' });

    await expect(methods.getConversationGoal(userId, 'c1')).resolves.toBeNull();
    await expect(methods.getConversationGoal(userId, 'c2')).resolves.not.toBeNull();
    await expect(mongoose.models.AgencyEvent.countDocuments({ userId })).resolves.toBe(1);
  });
});

describe('reflections', () => {
  it("lists them newest first, and edits only the learner's own, keeping when each was saved", async () => {
    const first = await methods.createAgencyReflection(userId, {
      ...blank,
      working_on: 'History essay',
      decision: 'Asked for questions',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await methods.createAgencyReflection(userId, { ...blank, happy: 'Yes' });
    expect(first.createdAt).toBe(first.updatedAt);

    const listed = await methods.listAgencyReflections(userId);
    expect(listed.map((reflection) => reflection.id)).toEqual([second.id, first.id]);
    expect(listed[1].answers).toEqual({
      working_on: 'History essay',
      decision: 'Asked for questions',
      reason: '',
      outcome: '',
      happy: '',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const edited = await methods.updateAgencyReflection(userId, first.id, {
      ...first.answers,
      outcome: 'Clearer argument',
    });
    expect(edited?.answers.outcome).toBe('Clearer argument');
    expect(edited?.createdAt).toBe(first.createdAt);
    expect(edited && edited.updatedAt > first.updatedAt).toBe(true);

    await expect(
      methods.updateAgencyReflection(otherUserId, first.id, { ...blank, happy: 'No' }),
    ).resolves.toBeNull();
    await expect(methods.updateAgencyReflection(userId, 'nope', blank)).resolves.toBeNull();
    await expect(methods.listAgencyReflections(otherUserId)).resolves.toEqual([]);
  });

  it('deletes reflections with the rest of the agency data', async () => {
    await methods.createAgencyReflection(userId, { ...blank, reason: 'Mine' });
    await methods.createAgencyReflection(otherUserId, { ...blank, reason: 'Theirs' });
    await methods.deleteAgencyData(userId);
    await expect(mongoose.models.AgencyReflection.countDocuments({ userId })).resolves.toBe(0);
    await expect(
      mongoose.models.AgencyReflection.countDocuments({ userId: otherUserId }),
    ).resolves.toBe(1);
  });
});
