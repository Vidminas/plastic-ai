import { Types } from 'mongoose';
import { GOAL_CHECK_OUTCOMES } from 'librechat-data-provider';
import type {
  TAgencyRecap,
  TAgencyEvent,
  AgencyFactor,
  TConversationGoal,
  TAgencyIntentions,
} from 'librechat-data-provider';
import type {
  IAgencyGoal,
  IAgencyEvent,
  IAgencyIntentions,
  RecordAgencyEventParams,
} from '~/types/agency';

type UserId = string | Types.ObjectId;

export type AgencyIntentionsUpdate = Pick<
  TAgencyIntentions,
  'goals' | 'intendedUse' | 'commitments'
> & {
  factors: Partial<Record<AgencyFactor, number>>;
};

export interface AgencyMethods {
  getAgencyIntentions(userId: UserId): Promise<TAgencyIntentions | null>;
  setAgencyIntentions(userId: UserId, update: AgencyIntentionsUpdate): Promise<TAgencyIntentions>;
  getConversationGoal(userId: UserId, conversationId: string): Promise<TConversationGoal | null>;
  setConversationGoal(
    userId: UserId,
    conversationId: string,
    text: string,
  ): Promise<TConversationGoal>;
  /** Deletes the goals of these conversations, or of every conversation when omitted. */
  deleteConversationGoals(userId: UserId, conversationIds?: string[]): Promise<number>;
  recordAgencyEvent(params: RecordAgencyEventParams): Promise<void>;
  /** Counts and the latest examples, for one conversation or all of them. */
  getAgencyRecap(userId: UserId, options?: { conversationId?: string }): Promise<TAgencyRecap>;
  /** Deletes the user's intentions, goals and engagement events. */
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
  text: doc.text,
  setAt: doc.setAt?.toISOString(),
});

const toEvent = (doc: IAgencyEvent): TAgencyEvent => ({
  type: doc.type,
  conversationId: doc.conversationId,
  messageId: doc.messageId,
  detail: doc.detail,
  createdAt: doc.createdAt.toISOString(),
});

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
  ): Promise<TConversationGoal> {
    const doc = await goalModel()
      .findOneAndUpdate(
        { userId, conversationId },
        { $set: { userId, conversationId, text, setAt: new Date() } },
        { upsert: true, new: true, runValidators: true },
      )
      .lean<IAgencyGoal>();
    return toGoal(doc as IAgencyGoal);
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
    { conversationId }: { conversationId?: string } = {},
  ): Promise<TAgencyRecap> {
    const scope = conversationId == null ? { userId } : { userId, conversationId };
    const events = eventModel();
    const count = (type: string, detail?: string) =>
      events.countDocuments({ ...scope, type, ...(detail != null ? { detail } : {}) });
    const latest = (type: string) =>
      events
        .findOne({ ...scope, type })
        .sort({ createdAt: -1 })
        .lean<IAgencyEvent>();

    const conversations =
      conversationId == null
        ? mongoose.models.Conversation.countDocuments({ user: String(userId) })
        : Promise.resolve(1);

    const [
      goalsSet,
      conversationCount,
      latestGoal,
      offered,
      selected,
      checksOffered,
      outcomes,
      latestOption,
      latestCheck,
    ] = await Promise.all([
      goalModel().countDocuments(scope),
      conversations,
      goalModel().findOne(scope).sort({ setAt: -1 }).lean<IAgencyGoal>(),
      count('options_offered'),
      count('option_selected'),
      count('goal_check_offered'),
      Promise.all(GOAL_CHECK_OUTCOMES.map((outcome) => count('goal_check_resolved', outcome))),
      latest('option_selected'),
      latest('goal_check_resolved'),
    ]);

    const examples: TAgencyRecap['examples'] = {};
    if (latestGoal) {
      examples.goal = {
        type: 'goal_set',
        conversationId: latestGoal.conversationId,
        detail: latestGoal.text,
        createdAt: latestGoal.setAt.toISOString(),
      };
    }
    if (latestOption) {
      examples.option = toEvent(latestOption);
    }
    if (latestCheck) {
      examples.goalCheck = toEvent(latestCheck);
    }

    return {
      goals: { set: goalsSet, conversations: Math.max(conversationCount, goalsSet) },
      options: { selected, offered },
      goalChecks: {
        offered: checksOffered,
        ...(Object.fromEntries(
          GOAL_CHECK_OUTCOMES.map((outcome, i) => [outcome, outcomes[i]]),
        ) as Record<(typeof GOAL_CHECK_OUTCOMES)[number], number>),
      },
      examples,
    };
  }

  async function deleteAgencyData(userId: UserId): Promise<void> {
    await Promise.all([
      intentionsModel().deleteMany({ userId }),
      goalModel().deleteMany({ userId }),
      eventModel().deleteMany({ userId }),
    ]);
  }

  return {
    getAgencyIntentions,
    setAgencyIntentions,
    getConversationGoal,
    setConversationGoal,
    deleteConversationGoals,
    recordAgencyEvent,
    getAgencyRecap,
    deleteAgencyData,
  };
}
