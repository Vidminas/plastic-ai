import { Types } from 'mongoose';
import { AGENCY_OWN_GOAL, AGENCY_REFLECTION_QUESTIONS } from 'librechat-data-provider';
import type {
  RecapRange,
  TAgencyRecap,
  AgencyFactor,
  TConversationGoal,
  TAgencyIntentions,
  TAgencyReflection,
  TAgencyReflectionAnswers,
} from 'librechat-data-provider';
import type {
  IAgencyGoal,
  IAgencyEvent,
  IAgencyIntentions,
  IAgencyReflection,
  RecordAgencyEventParams,
} from '~/types/agency';
import type { RecapJourneyEvent, RecapLabel } from './agencyRecap';
import { buildRecapJourney, computeRecapUsage, recapSince } from './agencyRecap';

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
  /** Deletes the goals of these conversations, or of every conversation when omitted. */
  deleteConversationGoals(userId: UserId, conversationIds?: string[]): Promise<number>;
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
  /** Deletes the user's intentions, goals, reflections and engagement events. */
  deleteAgencyData(userId: UserId): Promise<void>;
}

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
  $or: [{ type: { $in: ['goal_set', 'goal_updated', 'goal_check_resolved', 'reflection_saved'] } }],
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

  async function deleteConversationGoals(
    userId: UserId,
    conversationIds?: string[],
  ): Promise<number> {
    const filter =
      conversationIds == null ? { userId } : { userId, conversationId: { $in: conversationIds } };
    const { deletedCount } = await goalModel().deleteMany(filter);
    return deletedCount ?? 0;
  }

  async function recordAgencyEvent(params: RecordAgencyEventParams): Promise<void> {
    await eventModel().create({ ...params, createdAt: new Date() });
  }

  async function getAgencyRecap(
    userId: UserId,
    { conversationId, range = '7d', now = new Date() }: AgencyRecapOptions = {},
  ): Promise<TAgencyRecap> {
    const scope = conversationId == null ? { userId } : { userId, conversationId };
    const since = recapSince(range, now);
    const sinceFilter = since != null ? { createdAt: { $gte: since } } : {};
    const events = eventModel();

    /** Run once and shared: the topic read waits on it, and a query re-runs on every `then`. */
    const chats = mongoose.models.Message.distinct('conversationId', {
      user: String(userId),
      isCreatedByUser: true,
      isTemporary: { $ne: true },
      ...(conversationId != null ? { conversationId } : {}),
      ...sinceFilter,
    }).exec() as Promise<string[]>;

    const [
      conversations,
      conversationGoals,
      topicEvents,
      supportEvents,
      journeyEvents,
      reflections,
      reflectionCount,
    ] = await Promise.all([
      chats,
      goalModel()
        .find(scope)
        .select('conversationId text suggestionId setAt')
        .lean<IAgencyGoal[]>(),
      /** Only the period's chats need a topic, and a label from before the period still counts. */
      chats.then((ids) =>
        ids.length > 0
          ? events
              .find({ userId, type: 'topic_classified', conversationId: { $in: ids } })
              .sort({ createdAt: 1 })
              .select('conversationId detail')
              .lean<RecapLabel[]>()
          : [],
      ),
      events
        .find({ ...scope, type: 'support_classified', ...sinceFilter })
        .select('conversationId detail')
        .lean<RecapLabel[]>(),
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

    /** Sorted oldest first, so the latest label of each conversation wins. */
    const topics = new Map<string, string>();
    for (const label of topicEvents) {
      if (label.conversationId != null && label.detail != null) {
        topics.set(label.conversationId, label.detail);
      }
    }

    return {
      ...computeRecapUsage({
        conversations,
        goals: new Map(
          conversationGoals.map(
            (goal) => [goal.conversationId, goal.suggestionId ?? AGENCY_OWN_GOAL] as const,
          ),
        ),
        topics,
        support: supportEvents,
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

  async function deleteAgencyData(userId: UserId): Promise<void> {
    await Promise.all([
      intentionsModel().deleteMany({ userId }),
      goalModel().deleteMany({ userId }),
      eventModel().deleteMany({ userId }),
      reflectionModel().deleteMany({ userId }),
    ]);
  }

  return {
    getAgencyIntentions,
    setAgencyIntentions,
    getConversationGoal,
    setConversationGoal,
    deleteConversationGoals,
    listAgencyReflections,
    createAgencyReflection,
    updateAgencyReflection,
    getConversationTopic,
    recordAgencyEvent,
    getAgencyRecap,
    deleteAgencyData,
  };
}
