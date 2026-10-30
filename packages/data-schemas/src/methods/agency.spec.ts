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
    [
      'AgencyIntentions',
      'AgencyGoal',
      'AgencyEvent',
      'AgencyReflection',
      'AgencyPrompt',
      'AgencyPromptRevision',
      'Conversation',
      'Message',
    ].map((name) => mongoose.models[name].deleteMany({})),
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

describe('hidden instructions', () => {
  it('keeps one template per learner, replaced on each save, until deleted', async () => {
    await expect(methods.getAgencyPrompt(userId)).resolves.toBeNull();
    await methods.setAgencyPrompt(userId, 'First');
    const saved = await methods.setAgencyPrompt(userId, 'Second');
    await methods.setAgencyPrompt(otherUserId, 'Theirs');
    expect(saved.template).toBe('Second');
    expect(saved.updatedAt).toEqual(expect.any(String));
    await expect(mongoose.models.AgencyPrompt.countDocuments({ userId })).resolves.toBe(1);

    await methods.deleteAgencyPrompt(userId);
    await expect(methods.getAgencyPrompt(userId)).resolves.toBeNull();
    await expect(methods.getAgencyPrompt(otherUserId)).resolves.toMatchObject({
      template: 'Theirs',
    });
  });

  it('logs every change in order, a reset as null', async () => {
    const first = await methods.addAgencyPromptRevision(userId, 'First');
    const reset = await methods.addAgencyPromptRevision(userId, null);
    expect(first).not.toBe(reset);
    const log = await mongoose.models.AgencyPromptRevision.find({ userId })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    expect(log.map(({ template }) => template)).toEqual(['First', null]);
  });

  it('deletes the template and its log with the rest of the agency data', async () => {
    await methods.setAgencyPrompt(userId, 'Mine');
    await methods.addAgencyPromptRevision(userId, 'Mine');
    await methods.addAgencyPromptRevision(otherUserId, 'Theirs');
    await methods.deleteAgencyData(userId);
    await expect(methods.getAgencyPrompt(userId)).resolves.toBeNull();
    await expect(mongoose.models.AgencyPromptRevision.countDocuments({ userId })).resolves.toBe(0);
    await expect(
      mongoose.models.AgencyPromptRevision.countDocuments({ userId: otherUserId }),
    ).resolves.toBe(1);
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
  const now = new Date('2026-10-15T12:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const message = (conversationId: string, createdAt: Date, isCreatedByUser = true) => ({
    messageId: new mongoose.Types.ObjectId().toString(),
    conversationId,
    user: String(userId),
    isCreatedByUser,
    text: 'hidden',
    createdAt,
  });

  beforeEach(async () => {
    await methods.setConversationGoal(userId, 'c1', 'Plan an essay', 'writing');
    await methods.setConversationGoal(userId, 'c2', 'Revise algebra');
    await methods.setConversationGoal(userId, 'c5', 'Old goal', 'exams');
    await mongoose.models.Message.insertMany([
      message('c1', daysAgo(0)),
      message('c1', daysAgo(1)),
      message('c1', daysAgo(1), false),
      message('c2', daysAgo(2)),
      message('c3', daysAgo(3)),
      /** Only the assistant wrote in it this week. */
      message('c4', daysAgo(1), false),
      /** Before the week. */
      message('c5', daysAgo(9)),
      { ...message('c6', daysAgo(0)), isTemporary: true },
      { ...message('c7', daysAgo(0)), user: String(otherUserId) },
    ]);
    await mongoose.models.AgencyEvent.insertMany([
      {
        userId,
        conversationId: 'c1',
        type: 'topic_classified',
        detail: 'maths',
        createdAt: daysAgo(3),
      },
      {
        userId,
        conversationId: 'c1',
        type: 'topic_classified',
        detail: 'writing',
        createdAt: daysAgo(0),
      },
      {
        userId,
        conversationId: 'c2',
        type: 'topic_classified',
        detail: 'maths',
        createdAt: daysAgo(2),
      },
      {
        userId,
        conversationId: 'c1',
        type: 'support_classified',
        detail: 'feedback',
        createdAt: daysAgo(0),
      },
      {
        userId,
        conversationId: 'c1',
        type: 'support_classified',
        detail: 'nonsense',
        createdAt: daysAgo(1),
      },
      {
        userId,
        conversationId: 'c2',
        type: 'support_classified',
        detail: 'hint',
        createdAt: daysAgo(2),
      },
      {
        userId,
        conversationId: 'c5',
        type: 'support_classified',
        detail: 'answer',
        createdAt: daysAgo(9),
      },
    ]);
  });

  it("counts the period's chats by topic, kind of help and goal, for this user only", async () => {
    const recap = await methods.getAgencyRecap(userId, { range: '7d', now });

    expect(recap.chats).toBe(3);
    expect(recap.topics).toEqual([
      { id: 'maths', chats: 1 },
      { id: 'unclassified', chats: 1 },
      { id: 'writing', chats: 1 },
    ]);
    expect(recap.support).toEqual({ feedback: 1, other: 1, hint: 1 });
    expect(recap.goalUsage).toEqual([
      { goal: 'own', conversations: 1, topics: { maths: 1 }, support: { hint: 1 }, signals: {} },
      {
        goal: 'writing',
        conversations: 1,
        topics: { writing: 1 },
        support: { feedback: 1, other: 1 },
        signals: {},
      },
    ]);
    expect(recap.noGoal).toEqual({ conversations: 1 });
    /** Long-term intentions have a dialog of their own, so the recap does not read them. */
    expect(recap).not.toHaveProperty('intentions');
  });

  it("keeps a chat's topic labelled before the period", async () => {
    await mongoose.models.AgencyEvent.create({
      userId,
      conversationId: 'c5',
      type: 'topic_classified',
      detail: 'science',
      createdAt: daysAgo(20),
    });
    const recap = await methods.getAgencyRecap(userId, { now, range: '30d' });
    expect(recap.topics).toContainEqual({ id: 'science', chats: 1 });
  });

  it('counts every chat for all time, and one conversation alone when scoped', async () => {
    const all = await methods.getAgencyRecap(userId, { range: 'all', now });
    expect(all.chats).toBe(4);
    expect(all.goalUsage.map((group) => group.goal)).toEqual(['exams', 'own', 'writing']);
    expect(all.support.answer).toBe(1);

    const one = await methods.getAgencyRecap(userId, { conversationId: 'c1', range: 'all', now });
    expect(one.chats).toBe(1);
    expect(one.goalUsage).toEqual([
      {
        goal: 'writing',
        conversations: 1,
        topics: { writing: 1 },
        support: { feedback: 1, other: 1 },
        signals: {},
      },
    ]);
  });

  it('counts signs of agency once per message, by goal, and lists the latest', async () => {
    const signal = (conversationId: string, messageId: string, detail: string, age: number) => ({
      userId,
      conversationId,
      messageId,
      type: 'signal_classified',
      detail,
      createdAt: daysAgo(age),
    });
    await mongoose.models.Message.insertMany([
      {
        ...message('c1', daysAgo(0)),
        messageId: 'm2',
        text: 'Keep it\n\nto one page,   for a beginner',
      },
      { ...message('c3', daysAgo(1)), messageId: 'm3', text: 'x'.repeat(500) },
      /** Someone else's message with the same id is not quoted. */
      { ...message('c1', daysAgo(1)), messageId: 'm1', text: 'Theirs', user: String(otherUserId) },
    ]);
    await mongoose.models.AgencyEvent.insertMany([
      signal('c1', 'm1', 'redirect', 2),
      /** The same message, labelled again when its reply was regenerated. */
      signal('c1', 'm1', 'redirect', 1),
      signal('c1', 'm2', 'specify', 0),
      signal('c3', 'm3', 'negotiate', 0.5),
      /** Before the week. */
      signal('c1', 'm4', 'redirect', 9),
      { ...signal('c1', 'm6', 'preempt', 0), userId: otherUserId },
    ]);
    const recap = await methods.getAgencyRecap(userId, { range: '7d', now });
    expect(recap.signals.counts).toEqual({ redirect: 1, specify: 1, negotiate: 1 });
    /** m1 is not this learner's saved message, so there is nothing to quote. */
    expect(recap.signals.recent.map(({ messageId }) => messageId)).toEqual(['m2', 'm3']);
    expect(recap.signals.recent[0]).toMatchObject({
      signals: ['specify'],
      conversationId: 'c1',
      messageId: 'm2',
      excerpt: 'Keep it to one page, for a beginner',
    });
    expect(recap.signals.recent[1].excerpt).toHaveLength(241);
    expect(recap.goalUsage.find((group) => group.goal === 'writing')?.signals).toEqual({
      redirect: 1,
      specify: 1,
    });

    /** Removed signs take no place among the latest. */
    await mongoose.models.AgencyEvent.insertMany(
      ['m7', 'm8', 'm9', 'm10', 'm11'].map((id) => signal('c1', id, 'retired', 0)),
    );
    const configured = await methods.getAgencyRecap(userId, {
      range: '7d',
      now,
      signalIds: ['redirect', 'specify', 'negotiate'],
    });
    expect(configured.signals.counts).toEqual({ redirect: 1, specify: 1, negotiate: 1 });
    expect(configured.signals.recent.map(({ messageId }) => messageId)).toEqual(['m2', 'm3']);
  });

  it('builds the goal journey, newest first, with each goal as it is now', async () => {
    await methods.setConversationGoal(userId, 'c1', 'Revise algebra', 'exams');
    const reflection = await methods.createAgencyReflection(userId, {
      ...blank,
      working_on: 'History essay',
    });
    const at = (minutes: number) => new Date(now.getTime() - (60 - minutes) * 60_000);
    await mongoose.models.AgencyEvent.insertMany([
      { userId, type: 'goal_set', conversationId: 'c1', createdAt: at(1) },
      /** A goal since deleted with its conversation is left out. */
      { userId, type: 'goal_set', conversationId: 'gone', createdAt: at(2) },
      {
        userId,
        type: 'goal_check_resolved',
        conversationId: 'c1',
        messageId: 'm1',
        detail: 'continue',
        createdAt: at(3),
      },
      {
        userId,
        type: 'goal_check_resolved',
        conversationId: 'c1',
        messageId: 'm2',
        detail: 'goal_changed',
        createdAt: at(4),
      },
      { userId, type: 'goal_updated', conversationId: 'c1', createdAt: at(5) },
      { userId, type: 'reflection_saved', detail: reflection.id, createdAt: at(6) },
    ]);

    const recap = await methods.getAgencyRecap(userId, { now });
    expect(recap.journey.map((item) => item.type)).toEqual([
      'reflection',
      'goal_updated',
      'goal_check',
      'goal_check',
      'goal_set',
    ]);
    expect(recap.journey[0]).toMatchObject({
      reflectionId: reflection.id,
      about: 'History essay',
    });
    expect(recap.journey[1]).toMatchObject({
      conversationId: 'c1',
      goal: { text: 'Revise algebra', suggestionId: 'exams' },
    });
    expect(recap.journey[2]).toMatchObject({
      conversationId: 'c1',
      messageId: 'm2',
      outcome: 'goal_changed',
    });
    expect(recap.journey[3]).toMatchObject({ messageId: 'm1', outcome: 'continue' });
  });

  it("shows each goal as it was set, and only the period's steps", async () => {
    await methods.setConversationGoal(userId, 'c1', 'Quadratics', 'exams');
    await mongoose.models.AgencyEvent.insertMany([
      {
        userId,
        type: 'goal_set',
        conversationId: 'c1',
        detail: 'Revise algebra',
        createdAt: daysAgo(2),
      },
      {
        userId,
        type: 'goal_updated',
        conversationId: 'c1',
        detail: 'Quadratics',
        createdAt: daysAgo(1),
      },
      /** Before the week. */
      {
        userId,
        type: 'goal_updated',
        conversationId: 'c1',
        detail: 'Older',
        createdAt: daysAgo(9),
      },
    ]);

    const week = await methods.getAgencyRecap(userId, { now });
    expect(week.journey.map((item) => item.goal)).toEqual([
      { text: 'Quadratics', suggestionId: 'exams', setAt: expect.any(String) },
      { text: 'Revise algebra' },
    ]);
    const all = await methods.getAgencyRecap(userId, { now, range: 'all' });
    expect(all.journey.map((item) => item.goal?.text)).toEqual([
      'Quadratics',
      'Revise algebra',
      'Older',
    ]);
  });

  it("sums up the period's reflections, latest first", async () => {
    const make = (working_on: string) =>
      methods.createAgencyReflection(userId, { ...blank, working_on });
    const old = await make('Old essay');
    /** Past the model, whose timestamps would keep `createdAt` as it is. */
    await mongoose.models.AgencyReflection.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(old.id) },
      { $set: { createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000) } },
    );
    await make('Maths homework');
    /** Apart in time, so newest first has one answer. */
    await new Promise((resolve) => setTimeout(resolve, 5));
    await make('History essay');
    await methods.createAgencyReflection(otherUserId, { ...blank, working_on: 'Theirs' });

    const week = await methods.getAgencyRecap(userId, { now: new Date() });
    expect(week.reflections.count).toBe(2);
    expect(week.reflections.recent.map((r) => r.answers.working_on)).toEqual([
      'History essay',
      'Maths homework',
    ]);
    const all = await methods.getAgencyRecap(userId, { now: new Date(), range: 'all' });
    expect(all.reflections.count).toBe(3);
    /** One conversation's recap has no reflections of its own. */
    const scoped = await methods.getAgencyRecap(userId, { now: new Date(), conversationId: 'c1' });
    expect(scoped.reflections).toEqual({ count: 0, recent: [] });
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
});
