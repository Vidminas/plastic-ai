import { useId } from 'react';
import { Shapes } from 'lucide-react';
import type { TAgencyRecap } from 'librechat-data-provider';
import type { TopicSeries } from './topics';
import Panel, { PanelHeading } from './Panel';
import { rankTopics } from './topics';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * What the learner's chats in the period were about: each topic's share of them, named and
 * numbered, most first. Shares, not totals, so the panel says what the AI was used for rather
 * than how much.
 */
export default function TopicShares({
  recap,
  series,
}: {
  recap: TAgencyRecap;
  series: TopicSeries[];
}) {
  const localize = useLocalize();
  const headingId = useId();
  const total = recap.chats;
  const rows = rankTopics(
    Object.fromEntries(recap.topics.map(({ id, chats }) => [id, chats])),
    series,
  );
  return (
    <Panel>
      <PanelHeading
        id={headingId}
        icon={Shapes}
        tone="teal"
        title={localize('com_agency_topics_title')}
      />
      <p className="text-text-secondary -mt-2 mb-3 text-sm">{localize('com_agency_topics_help')}</p>
      {rows.length === 0 || total === 0 ? (
        <p className="text-text-secondary text-sm">{localize('com_agency_support_empty')}</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-2.5">
          {rows.map(({ topic, chats }) => {
            const percent = Math.round((chats / total) * 100);
            return (
              <li key={topic.id} className="flex flex-col gap-1">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="text-text-primary flex items-center gap-2">
                    <span
                      className={cn('size-2.5 rounded-full', topic.swatch)}
                      aria-hidden="true"
                    />
                    {topic.label}
                  </span>
                  <span className="text-text-secondary tabular-nums">{percent}%</span>
                </div>
                <div
                  className="bg-surface-tertiary h-2 overflow-hidden rounded-full"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-label={topic.label}
                >
                  <div
                    className={cn('h-full rounded-full', topic.swatch)}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
