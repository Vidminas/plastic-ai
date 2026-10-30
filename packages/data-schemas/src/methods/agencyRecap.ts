import {
  isGoalCheckOutcome,
  AGENCY_SUPPORT_TYPES,
  AGENCY_UNCLASSIFIED_TOPIC,
} from 'librechat-data-provider';
import type {
  RecapRange,
  TAgencyRecap,
  TConversationGoal,
  AgencySupportType,
  TAgencyGoalUsage,
  TAgencyJourneyItem,
} from 'librechat-data-provider';

/** Days in each fixed range, counted back from now; `all` has no start. */
const RECAP_RANGE_DAYS: Record<Exclude<RecapRange, 'all'>, number> = { '7d': 7, '30d': 30 };

/** Journey steps the recap shows at most. */
const RECAP_JOURNEY_MAX = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a range starts: that many days before now, or undefined for `all`. */
export function recapSince(range: RecapRange, now: Date): Date | undefined {
  return range === 'all' ? undefined : new Date(now.getTime() - RECAP_RANGE_DAYS[range] * DAY_MS);
}

/** How many of a chat's messages asked for one kind of support in the period. */
export interface RecapSupportCount {
  conversationId?: string;
  detail?: string;
  messages: number;
}

export interface RecapUsageInput {
  /** Chats the learner wrote in during the period. */
  conversations: readonly string[];
  /**
   * Conversation id to the goal it is grouped under: the suggestion its goal started from, or
   * `own`. A conversation without a goal is absent.
   */
  goals: ReadonlyMap<string, string>;
  /** Conversation id to its latest topic label. */
  topics: ReadonlyMap<string, string>;
  /** Labelled messages in the period, by chat and kind of support. */
  support: readonly RecapSupportCount[];
}

export type RecapUsage = Pick<
  TAgencyRecap,
  'chats' | 'topics' | 'support' | 'goalUsage' | 'noGoal'
>;

const isSupportType = (value: string | undefined): value is AgencySupportType =>
  (AGENCY_SUPPORT_TYPES as readonly string[]).includes(value ?? '');

const increment = <K extends string>(counts: Partial<Record<K, number>>, key: K, by = 1): void => {
  counts[key] = (counts[key] ?? 0) + by;
};

const byCount = <T>(counts: Map<string, T>, size: (value: T) => number) =>
  [...counts].sort((a, b) => size(b[1]) - size(a[1]) || a[0].localeCompare(b[0]));

/**
 * What the period's chats were for: how many there were, by topic, by goal (with each goal's
 * topics and kinds of help), and the kinds of help asked for overall.
 */
export function computeRecapUsage({
  conversations,
  goals,
  topics,
  support,
}: RecapUsageInput): RecapUsage {
  const chats = new Set(conversations);
  const topicChats = new Map<string, number>();
  const groups = new Map<
    string,
    { conversations: number; topics: Record<string, number>; support: TAgencyGoalUsage['support'] }
  >();
  let noGoal = 0;

  for (const conversationId of chats) {
    const topic = topics.get(conversationId) ?? AGENCY_UNCLASSIFIED_TOPIC;
    topicChats.set(topic, (topicChats.get(topic) ?? 0) + 1);
    const goal = goals.get(conversationId);
    if (goal == null) {
      noGoal += 1;
      continue;
    }
    const group = groups.get(goal) ?? { conversations: 0, topics: {}, support: {} };
    group.conversations += 1;
    increment(group.topics, topic);
    groups.set(goal, group);
  }

  const overall: TAgencyRecap['support'] = {};
  for (const { conversationId, detail, messages } of support) {
    const type = isSupportType(detail) ? detail : 'other';
    increment(overall, type, messages);
    const goal = conversationId != null ? goals.get(conversationId) : undefined;
    const group = goal != null ? groups.get(goal) : undefined;
    if (group != null) {
      increment(group.support, type, messages);
    }
  }

  return {
    chats: chats.size,
    topics: byCount(topicChats, (count) => count).map(([id, count]) => ({ id, chats: count })),
    support: overall,
    goalUsage: byCount(groups, (group) => group.conversations).map(([goal, group]) => ({
      goal,
      ...group,
    })),
    noGoal: { conversations: noGoal },
  };
}

export interface RecapJourneyEvent {
  type: string;
  conversationId?: string;
  messageId?: string;
  detail?: string;
  createdAt: Date;
}

/**
 * The goal journey from the engagement events, newest first: conversation goals set and
 * changed, each with the goal as it was then (the event's detail; the goal as it is now for an
 * event recorded without one), goal checks and how they were answered, and reflections.
 * A step whose conversation goal or reflection has since been deleted is left out.
 */
export function buildRecapJourney(
  events: RecapJourneyEvent[],
  goals: ReadonlyMap<string, TConversationGoal>,
  /** Reflection id to what the learner was working on (possibly empty). */
  reflections: ReadonlyMap<string, string>,
): TAgencyJourneyItem[] {
  const items: TAgencyJourneyItem[] = [];
  const sorted = [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const event of sorted) {
    if (items.length >= RECAP_JOURNEY_MAX) {
      break;
    }
    const at = event.createdAt.toISOString();
    const where = {
      ...(event.conversationId != null ? { conversationId: event.conversationId } : {}),
      ...(event.messageId != null ? { messageId: event.messageId } : {}),
    };
    if (event.type === 'goal_set' || event.type === 'goal_updated') {
      const current = event.conversationId != null ? goals.get(event.conversationId) : undefined;
      if (current != null) {
        const goal =
          event.detail == null || event.detail === current.text ? current : { text: event.detail };
        items.push({ type: event.type, at, goal, ...where });
      }
    } else if (event.type === 'goal_check_resolved' && isGoalCheckOutcome(event.detail)) {
      items.push({ type: 'goal_check', at, outcome: event.detail, ...where });
    } else if (event.type === 'reflection_saved') {
      const about = event.detail != null ? reflections.get(event.detail) : undefined;
      if (about != null && event.detail != null) {
        items.push({
          type: 'reflection',
          at,
          reflectionId: event.detail,
          ...(about ? { about } : {}),
        });
      }
    }
  }
  return items;
}
