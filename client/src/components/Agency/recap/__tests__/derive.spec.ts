import type { TAgencyRecap } from 'librechat-data-provider';
import { foldTopics, rankTopics, topicSeries } from '../topics';
import { takeaways } from '../derive';

const base: TAgencyRecap = {
  chats: 4,
  support: {},
  signals: { counts: {}, recent: [] },
  topics: [],
  goalUsage: [],
  noGoal: { conversations: 0 },
  journey: [],
  reflections: { count: 0, recent: [] },
};

const series = topicSeries([{ id: 'maths', label: 'Maths' }], {
  other: 'Other',
  unclassified: 'Not yet sorted',
});

describe('takeaways', () => {
  it('says nothing for a period without chats', () => {
    expect(takeaways({ ...base, chats: 0 }, series)).toEqual([]);
  });

  it('names the main goal, topic and kind of help as shares, and chats without a goal', () => {
    expect(
      takeaways(
        {
          ...base,
          support: { other: 6, hint: 3, answer: 1 },
          goalUsage: [
            { goal: 'exams', conversations: 2, support: {}, signals: {}, topics: {} },
            { goal: 'own', conversations: 1, support: {}, signals: {}, topics: {} },
          ],
          topics: [
            { id: 'unclassified', chats: 2 },
            { id: 'maths', chats: 1 },
          ],
          noGoal: { conversations: 1 },
        },
        series,
      ),
    ).toEqual([
      { kind: 'top_goal', goal: 'exams', percent: 50 },
      { kind: 'top_topic', topic: 'maths', percent: 25 },
      { kind: 'top_support', support: 'hint', percent: 30 },
      { kind: 'no_goal', conversations: 1 },
    ]);
  });
});

describe('topic series', () => {
  const series = topicSeries(
    [
      { id: 'maths', label: 'Maths' },
      { id: 'writing', label: 'Writing' },
    ],
    { other: 'Other', unclassified: 'Not yet sorted' },
  );

  it('keeps the configured order, then other and unclassified, each with its colour', () => {
    expect(series.map((entry) => [entry.id, entry.swatch])).toEqual([
      ['maths', 'bg-series-2'],
      ['writing', 'bg-series-3'],
      ['other', 'bg-border-heavy'],
      ['unclassified', 'bg-border-medium'],
    ]);
  });

  it('folds topics no longer configured into other, and ranks them by chats', () => {
    const chats = { maths: 1, history: 1, other: 2, writing: 0 };
    expect(foldTopics(chats, series)).toEqual({ maths: 1, other: 3, writing: 0 });
    expect(rankTopics(chats, series).map(({ topic, chats: n }) => [topic.id, n])).toEqual([
      ['other', 3],
      ['maths', 1],
    ]);
  });
});
