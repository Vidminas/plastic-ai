import { Types } from 'mongoose';
import { AGENCY_OWN_GOAL, AGENCY_REFLECTION_QUESTIONS } from 'librechat-data-provider';
import type {
  RecapRange,
  TAgencyRecap,
  AgencyFactor,
  TAgencyPrompt,
  TConversationGoal,
  TAgencyIntentions,
  TAgencyReflection,
  TAgencyReflectionAnswers,
} from 'librechat-data-provider';
import type { PipelineStage } from 'mongoose';
import type {
  IAgencyGoal,
  IAgencyEvent,
  IAgencyPrompt,
  IAgencyIntentions,
  IAgencyReflection,
  RecordAgencyEventParams,
} from '~/types/agency';
import type { RecapJourneyEvent } from './agencyRecap';
import {
  recapSince,
  recapExcerpt,
  buildRecapJourney,
  computeRecapUsage,
  RECAP_SIGNALS_RECENT,
} from './agencyRecap';

type UserId = string | Types.ObjectId;

export type AgencyIntentionsUpdate = Pick<
  TAgencyIntentions,
  'goals' | 'intendedUse' | 'commitments'
> & {
  factors: Partial<Record<AgencyFactor, number>>;
};

export interface AgencyRecapOptions {
  conversationId?: string;
  range?: RecapRange;
  now?: Date;
  /** Only these signs of agency, so that removed ones take no place among the latest. */
  signalIds?: string[];
}

export interface AgencyMethods {
  getAgencyIntentions(userId: UserId): Promise<TAgencyIntentions | null>;
  setAgencyIntentions(userId: UserId, update: AgencyIntentionsUpdate): Promise<TAgencyIntentions>;
  getConversationGoal(userId: UserId, conversationId: string): Promise<TConversationGoal | null>;
  /**
   * Saves a conversation's goal. `suggestionId` records the suggested goal it started from;
   * null drops it, and undefined leaves it as it is.
   */
  setConversationGoal(
    userId: UserId,
    conversationId: string,
    text: string,
    suggestionId?: string | null,
  ): Promise<TConversationGoal>;
  /** The learner's reflections, newest first. */
  listAgencyReflections(userId: UserId): Promise<TAgencyReflection[]>;
  createAgencyReflection(
    userId: UserId,
    answers: TAgencyReflectionAnswers,
  ): Promise<TAgencyReflection>;
  /** Replaces a reflection's answers; null when there is no such reflection of theirs. */
  updateAgencyReflection(
    userId: UserId,
    reflectionId: string,
    answers: TAgencyReflectionAnswers,
  ): Promise<TAgencyReflection | null>;
  /** The learner's latest topic label for a conversation, or null. */
  getConversationTopic(userId: UserId, conversationId: string): Promise<string | null>;
  recordAgencyEvent(params: RecordAgencyEventParams): Promise<void>;
  /** What the period's chats were for, and the goal journey, for one conversation or all. */
  getAgencyRecap(userId: UserId, options?: AgencyRecapOptions): Promise<TAgencyRecap>;
  /** The learner's own hidden instructions, or null when the default applies. */
  getAgencyPrompt(userId: UserId): Promise<TAgencyPrompt | null>;
  setAgencyPrompt(userId: UserId, template: string): Promise<TAgencyPrompt>;
  deleteAgencyPrompt(userId: UserId): Promise<void>;
  /** Adds one change to the log of the learner's hidden instructions; null is a reset. */
  addAgencyPromptRevision(userId: UserId, template: string | null): Promise<string>;
  /**
   * Deletes the user's intentions, goals, reflections, hidden instructions and their log, and
   * engagement events.
   */
  deleteAgencyData(userId: UserId): Promise<void>;
}

const toPrompt = (doc: IAgencyPrompt): TAgencyPrompt => ({
  template: doc.template,
  ...(doc.updatedAt ? { updatedAt: doc.updatedAt.toISOString() } : {}),
});

const toIntentions = (doc: IAgencyIntentions): TAgencyIntentions => ({
  goals: doc.goals ?? '',
  intendedUse: doc.intendedUse ?? '',
  commitments: doc.commitments ?? '',
  factors: { ...(doc.factors ?? {}) },
  updatedAt: doc.updatedAt?.toISOString(),
});

const toGoal = (doc: IAgencyGoal): TConversationGoal => ({
  text: doc.text ?? '',
  ...(doc.suggestionId != null ? { suggestionId: doc.suggestionId } : {}),
  setAt: doc.setAt?.toISOString(),
});

const toReflection = (doc: IAgencyReflection): TAgencyReflection => ({
  id: String(doc._id),
  answers: Object.fromEntries(
    AGENCY_REFLECTION_QUESTIONS.map((question) => [question, doc.answers?.[question] ?? '']),
  ) as TAgencyReflectionAnswers,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: (doc.updatedAt ?? doc.createdAt).toISOString(),
});

/** Journey events (and reflections) read for a recap, of which the journey shows the latest. */
const JOURNEY_EVENTS_READ = 60;

/** Reflections the recap's overview shows. */
const RECAP_REFLECTIONS_SHOWN = 3;

/** The engagement events the goal journey is made of. */
const JOURNEY_FILTER = {
  type: { $in: ['goal_set', 'goal_updated', 'goal_check_resolved', 'reflection_saved'] },
};

/**
 * Deletes the goals and engagement events of deleted conversations. Called from
 * `deleteConvos`, so whatever removes a conversation removes these with it.
 */
export async function deleteAgencyConversationData(
  mongoose: typeof import('mongoose'),
  userId: UserId,
  conversationIds: string[],
): Promise<void> {
  if (conversationIds.length === 0 || !Types.ObjectId.isValid(String(userId))) {
    return;
  }
  const filter = { userId, conversationId: { $in: conversationIds } };
  await Promise.all([
    mongoose.models.AgencyGoal?.deleteMany(filter),
    mongoose.models.AgencyEvent?.deleteMany(filter),
  ]);
}

export function createAgencyMethods(mongoose: typeof import('mongoose')): AgencyMethods {
  const intentionsModel = () => mongoose.models.AgencyIntentions;
  const goalModel = () => mongoose.models.AgencyGoal;
  const eventModel = () => mongoose.models.AgencyEvent;
  const reflectionModel = () => mongoose.models.AgencyReflection;
  const promptModel = () => mongoose.models.AgencyPrompt;
  const promptRevisionModel = () => mongoose.models.AgencyPromptRevision;

  async function getAgencyIntentions(userId: UserId): Promise<TAgencyIntentions | null> {
    const doc = await intentionsModel().findOne({ userId }).lean<IAgencyIntentions>();
    return doc ? toIntentions(doc) : null;
  }

  async function setAgencyIntentions(
    userId: UserId,
    update: AgencyIntentionsUpdate,
  ): Promise<TAgencyIntentions> {
    const doc = await intentionsModel()
      .findOneAndUpdate(
        { userId },
        { $set: { ...update, userId } },
        { upsert: true, new: true, runValidators: true },
      )
      .lean<IAgencyIntentions>();
    return toIntentions(doc as IAgencyIntentions);
  }

  async function getConversationGoal(
    userId: UserId,
    conversationId: string,
  ): Promise<TConversationGoal | null> {
    const doc = await goalModel().findOne({ userId, conversationId }).lean<IAgencyGoal>();
    return doc ? toGoal(doc) : null;
  }

  async function setConversationGoal(
    userId: UserId,
    conversationId: string,
    text: string,
    suggestionId?: string | null,
  ): Promise<TConversationGoal> {
    const set: Record<string, unknown> = { userId, conversationId, text, setAt: new Date() };
    if (suggestionId != null) {
      set.suggestionId = suggestionId;
    }
    const doc = await goalModel()
      .findOneAndUpdate(
        { userId, conversationId },
        suggestionId === null ? { $set: set, $unset: { suggestionId: 1 } } : { $set: set },
        { upsert: true, new: true, runValidators: true },
      )
      .lean<IAgencyGoal>();
    return toGoal(doc as IAgencyGoal);
  }

  async function listAgencyReflections(userId: UserId): Promise<TAgencyReflection[]> {
    const docs = await reflectionModel()
      .find({ userId })
      .sort({ createdAt: -1 })
      .lean<IAgencyReflection[]>();
    return docs.map(toReflection);
  }

  async function createAgencyReflection(
    userId: UserId,
    answers: TAgencyReflectionAnswers,
  ): Promise<TAgencyReflection> {
    const doc = await reflectionModel().create({ userId, answers });
    return toReflection(doc.toObject() as IAgencyReflection);
  }

  async function updateAgencyReflection(
    userId: UserId,
    reflectionId: string,
    answers: TAgencyReflectionAnswers,
  ): Promise<TAgencyReflection | null> {
    if (!Types.ObjectId.isValid(reflectionId)) {
      return null;
    }
    const doc = await reflectionModel()
      .findOneAndUpdate(
        { _id: reflectionId, userId },
        { $set: { answers } },
        { new: true, runValidators: true },
      )
      .lean<IAgencyReflection>();
    return doc ? toReflection(doc) : null;
  }

  async function getConversationTopic(
    userId: UserId,
    conversationId: string,
  ): Promise<string | null> {
    const doc = await eventModel()
      .findOne({ userId, conversationId, type: 'topic_classified' })
      .sort({ createdAt: -1 })
      .lean<IAgencyEvent>();
    return doc?.detail ?? null;
  }

  async function recordAgencyEvent(params: RecordAgencyEventParams): Promise<void> {
    await eventModel().create({ ...params, createdAt: new Date() });
  }

  async function getAgencyRecap(
    userId: UserId,
    { conversationId, range = '7d', now = new Date(), signalIds }: AgencyRecapOptions = {},
  ): Promise<TAgencyRecap> {
    const scope = conversationId == null ? { userId } : { userId, conversationId };
    const since = recapSince(range, now);
    const sinceFilter = since != null ? { createdAt: { $gte: since } } : {};
    const events = eventModel();
    /** Aggregations do not cast their filters as `find` does. */
    const eventOwner = { userId: new Types.ObjectId(String(userId)) };
    const eventChats = { conversationId: conversationId ?? { $type: 'string' } };
    /** One row per message and sign: a turn labelled twice counts once. */
    const markedMessages: PipelineStage[] = [
      {
        $match: {
          ...eventOwner,
          ...eventChats,
          type: 'signal_classified',
          messageId: { $type: 'string' },
          detail: signalIds != null ? { $in: signalIds } : { $type: 'string' },
          ...sinceFilter,
        },
      },
      {
        $group: {
          _id: { conversationId: '$conversationId', messageId: '$messageId', signal: '$detail' },
          at: { $max: '$createdAt' },
        },
      },
    ];

    const [
      conversations,
      conversationGoals,
      topicLabels,
      supportCounts,
      signalCounts,
      recentSignals,
      journeyEvents,
      reflections,
      reflectionCount,
    ] = await Promise.all([
      mongoose.models.Message.distinct('conversationId', {
        user: String(userId),
        isCreatedByUser: true,
        isTemporary: { $ne: true },
        ...(conversationId != null ? { conversationId } : {}),
        ...sinceFilter,
      }).exec() as Promise<string[]>,
      goalModel()
        .find(scope)
        .select('conversationId text suggestionId setAt')
        .lean<IAgencyGoal[]>(),
      /** Each chat's latest topic: a label from before the period still counts. */
      events.aggregate<{ _id: string; topic: string }>([
        {
          $match: {
            ...eventOwner,
            ...eventChats,
            type: 'topic_classified',
            detail: { $type: 'string' },
          },
        },
        { $sort: { createdAt: 1 } },
        { $group: { _id: '$conversationId', topic: { $last: '$detail' } } },
      ]),
      events.aggregate<{ _id: { conversationId?: string; detail?: string }; messages: number }>([
        {
          $match: {
            ...eventOwner,
            ...(conversationId != null ? { conversationId } : {}),
            type: 'support_classified',
            ...sinceFilter,
          },
        },
        {
          $group: {
            _id: { conversationId: '$conversationId', detail: '$detail' },
            messages: { $sum: 1 },
          },
        },
      ]),
      events.aggregate<{ _id: { conversationId: string; signal: string }; messages: number }>([
        ...markedMessages,
        {
          $group: {
            _id: { conversationId: '$_id.conversationId', signal: '$_id.signal' },
            messages: { $sum: 1 },
          },
        },
      ]),
      /** The latest marked messages, each with its signs, and the words of each to quote. */
      events
        .aggregate<{
          _id: { conversationId: string; messageId: string };
          at: Date;
          signals: string[];
        }>([
          ...markedMessages,
          {
            $group: {
              _id: { conversationId: '$_id.conversationId', messageId: '$_id.messageId' },
              at: { $max: '$at' },
              signals: { $push: '$_id.signal' },
            },
          },
          { $sort: { at: -1 } },
          { $limit: RECAP_SIGNALS_RECENT },
        ])
        .then(async (marked) => {
          const texts =
            marked.length > 0
              ? await mongoose.models.Message.find({
                  user: String(userId),
                  messageId: { $in: marked.map(({ _id }) => _id.messageId) },
                })
                  .select('messageId text')
                  .lean<Array<{ messageId: string; text?: string | null }>>()
              : [];
          const textOf = new Map(texts.map(({ messageId, text }) => [messageId, text]));
          return marked.flatMap(({ _id, at, signals }) => {
            const excerpt = recapExcerpt(textOf.get(_id.messageId));
            return excerpt ? [{ ..._id, signals, excerpt, at: at.toISOString() }] : [];
          });
        }),
      events
        .find({ ...scope, ...JOURNEY_FILTER, ...sinceFilter })
        .sort({ createdAt: -1 })
        .limit(JOURNEY_EVENTS_READ)
        .select('type conversationId messageId detail createdAt')
        .lean<RecapJourneyEvent[]>(),
      /** The period's reflections, for the overview and for what each journey step names. */
      conversationId == null
        ? reflectionModel()
            .find({ userId, ...sinceFilter })
            .sort({ createdAt: -1 })
            .limit(JOURNEY_EVENTS_READ)
            .lean<IAgencyReflection[]>()
        : Promise.resolve([] as IAgencyReflection[]),
      conversationId == null
        ? reflectionModel().countDocuments({ userId, ...sinceFilter })
        : Promise.resolve(0),
    ]);

    return {
      ...computeRecapUsage({
        conversations,
        goals: new Map(
          conversationGoals.map(
            (goal) => [goal.conversationId, goal.suggestionId ?? AGENCY_OWN_GOAL] as const,
          ),
        ),
        topics: new Map(topicLabels.map(({ _id, topic }) => [_id, topic])),
        support: supportCounts.map(({ _id, messages }) => ({ ..._id, messages })),
        signals: signalCounts.map(({ _id, messages }) => ({ ..._id, messages })),
        recentSignals,
      }),
      journey: buildRecapJourney(
        journeyEvents,
        new Map(conversationGoals.map((goal) => [goal.conversationId, toGoal(goal)])),
        new Map(reflections.map((doc) => [String(doc._id), doc.answers?.working_on ?? ''])),
      ),
      reflections: {
        count: reflectionCount,
        recent: reflections.slice(0, RECAP_REFLECTIONS_SHOWN).map(toReflection),
      },
    };
  }

  async function getAgencyPrompt(userId: UserId): Promise<TAgencyPrompt | null> {
    const doc = await promptModel().findOne({ userId }).lean<IAgencyPrompt>();
    return doc ? toPrompt(doc) : null;
  }

  async function setAgencyPrompt(userId: UserId, template: string): Promise<TAgencyPrompt> {
    const doc = await promptModel()
      .findOneAndUpdate(
        { userId },
        { $set: { template, userId } },
        { upsert: true, new: true, runValidators: true },
      )
      .lean<IAgencyPrompt>();
    return toPrompt(doc as IAgencyPrompt);
  }

  async function deleteAgencyPrompt(userId: UserId): Promise<void> {
    await promptModel().deleteOne({ userId });
  }

  async function addAgencyPromptRevision(userId: UserId, template: string | null): Promise<string> {
    const doc = await promptRevisionModel().create({ userId, template });
    return String(doc._id);
  }

  async function deleteAgencyData(userId: UserId): Promise<void> {
    await Promise.all([
      intentionsModel().deleteMany({ userId }),
      goalModel().deleteMany({ userId }),
      eventModel().deleteMany({ userId }),
      reflectionModel().deleteMany({ userId }),
      promptModel().deleteMany({ userId }),
      promptRevisionModel().deleteMany({ userId }),
    ]);
  }

  return {
    getAgencyIntentions,
    setAgencyIntentions,
    getConversationGoal,
    setConversationGoal,
    listAgencyReflections,
    createAgencyReflection,
    updateAgencyReflection,
    getConversationTopic,
    recordAgencyEvent,
    getAgencyRecap,
    getAgencyPrompt,
    setAgencyPrompt,
    deleteAgencyPrompt,
    addAgencyPromptRevision,
    deleteAgencyData,
  };
}
