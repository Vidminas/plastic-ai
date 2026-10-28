import { AGENCY_OTHER_TOPIC, AGENCY_UNCLASSIFIED_TOPIC } from 'librechat-data-provider';
import type { AgencySupportType, TAgencyRecap } from 'librechat-data-provider';
import type { TopicSeries } from './topics';
import { rankTopics } from './topics';

/** One key takeaway, as a translation key with its values; the page words it. */
export type Takeaway =
  /** `goal` is a suggestion's id, or `own`; the page names it. */
  | { kind: 'top_goal'; goal: string; percent: number }
  | { kind: 'top_topic'; topic: string; percent: number }
  | { kind: 'top_support'; support: AgencySupportType; percent: number }
  | { kind: 'no_goal'; conversations: number };

const percentOf = (part: number, whole: number) => Math.round((part / whole) * 100);

/**
 * Up to four things worth noticing in the period, worked out from the counts alone and said as
 * shares, never totals: the goal most chats were for, the topic most were about, the kind of
 * help asked for most, and how many chats had no goal.
 */
export function takeaways(recap: TAgencyRecap, series: TopicSeries[]): Takeaway[] {
  const { chats } = recap;
  if (chats === 0) {
    return [];
  }
  const found: Takeaway[] = [];
  /** Most first, as the server sends them. */
  const [topGoal] = recap.goalUsage;
  if (topGoal != null && topGoal.conversations > 0) {
    found.push({
      kind: 'top_goal',
      goal: topGoal.goal,
      percent: percentOf(topGoal.conversations, chats),
    });
  }
  const [topTopic] = rankTopics(
    Object.fromEntries(recap.topics.map(({ id, chats: n }) => [id, n])),
    series,
  ).filter(
    ({ topic }) => topic.id !== AGENCY_OTHER_TOPIC && topic.id !== AGENCY_UNCLASSIFIED_TOPIC,
  );
  if (topTopic != null) {
    found.push({
      kind: 'top_topic',
      topic: topTopic.topic.id,
      percent: percentOf(topTopic.chats, chats),
    });
  }
  const support = Object.entries(recap.support) as Array<[AgencySupportType, number]>;
  const labelled = support.reduce((sum, [, count]) => sum + count, 0);
  const [topSupport] = support.filter(([type]) => type !== 'other').sort((a, b) => b[1] - a[1]);
  if (topSupport != null && labelled > 0) {
    found.push({
      kind: 'top_support',
      support: topSupport[0],
      percent: percentOf(topSupport[1], labelled),
    });
  }
  if (recap.noGoal.conversations > 0) {
    found.push({ kind: 'no_goal', conversations: recap.noGoal.conversations });
  }
  return found;
}
