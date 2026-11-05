import { AGENCY_OTHER_TOPIC, AGENCY_UNCLASSIFIED_TOPIC } from 'librechat-data-provider';
import type { TAgencyTopic } from 'librechat-data-provider';

/**
 * The theme's categorical series, warm first: a topic keeps its colour by its place in
 * `agency.classifier.topics`, never by how much it was used. This order passes the palette
 * checks (colour-blind and normal-vision separation of neighbours) in light and dark. Spelled
 * out so Tailwind keeps every class.
 */
const SERIES = [
  'bg-series-2',
  'bg-series-3',
  'bg-series-4',
  'bg-series-6',
  'bg-series-5',
  'bg-series-7',
  'bg-series-1',
] as const;

/** "Other" and "not yet labelled" are recessive, not another hue. */
const NEUTRAL = 'bg-border-heavy';
const UNLABELLED = 'bg-border-medium';

/** A topic the page names: its id, label and colour swatch, in the configured order. */
export type TopicSeries = { id: string; label: string; swatch: string };

/**
 * The topics the page shows: the configured ones in order, then "other" and "not yet labelled".
 * A topic no longer configured counts as "other".
 */
export function topicSeries(
  topics: TAgencyTopic[],
  labels: { other: string; unclassified: string },
): TopicSeries[] {
  return [
    ...topics.slice(0, SERIES.length).map((topic, i) => ({ ...topic, swatch: SERIES[i] })),
    { id: AGENCY_OTHER_TOPIC, label: labels.other, swatch: NEUTRAL },
    { id: AGENCY_UNCLASSIFIED_TOPIC, label: labels.unclassified, swatch: UNLABELLED },
  ];
}

/** The series a recorded topic id is counted under. */
export function seriesOf(id: string, series: TopicSeries[]): string {
  return series.some((entry) => entry.id === id) ? id : AGENCY_OTHER_TOPIC;
}

/** Chats by topic id, folded onto the series (unknown ids into "other"). */
export function foldTopics(
  chats: Readonly<Record<string, number>>,
  series: TopicSeries[],
): Record<string, number> {
  const folded: Record<string, number> = {};
  for (const [id, count] of Object.entries(chats)) {
    const key = seriesOf(id, series);
    folded[key] = (folded[key] ?? 0) + count;
  }
  return folded;
}

/** The series by how many chats each has, most first, leaving out those with none. */
export function rankTopics(
  chats: Readonly<Record<string, number>>,
  series: TopicSeries[],
): Array<{ topic: TopicSeries; chats: number }> {
  const folded = foldTopics(chats, series);
  return series
    .map((topic) => ({ topic, chats: folded[topic.id] ?? 0 }))
    .filter(({ chats: count }) => count > 0)
    .sort((a, b) => b.chats - a.chats);
}
