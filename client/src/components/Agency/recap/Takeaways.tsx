import { useId } from 'react';
import { Shapes, Target, Sparkles, Lightbulb, CircleDashed } from 'lucide-react';
import type { TAgencyRecap } from 'librechat-data-provider';
import type { TopicSeries } from './topics';
import type { Takeaway } from './derive';
import type { Tone } from './Panel';
import Panel, { PanelHeading, ToneIcon } from './Panel';
import { SUPPORT_KEYS } from './labels';
import { useGoalName } from './Goals';
import { useLocalize } from '~/hooks';
import { takeaways } from './derive';

const ICONS = {
  top_goal: Target,
  top_topic: Shapes,
  top_support: Lightbulb,
  no_goal: CircleDashed,
};

const TONE: Record<keyof typeof ICONS, Tone> = {
  top_goal: 'orange',
  top_topic: 'teal',
  top_support: 'amber',
  no_goal: 'pink',
};

/** What stands out in the period, worded from the counts as shares; no model is asked. */
export default function Takeaways({
  recap,
  series,
}: {
  recap: TAgencyRecap;
  series: TopicSeries[];
}) {
  const localize = useLocalize();
  const headingId = useId();
  const found = takeaways(recap, series);
  const nameOf = useGoalName();
  const text = (takeaway: Takeaway): string => {
    switch (takeaway.kind) {
      case 'top_goal':
        return localize('com_agency_takeaway_top_goal', {
          0: nameOf(takeaway.goal),
          1: takeaway.percent,
        });
      case 'top_topic':
        return localize('com_agency_takeaway_top_topic', {
          0: series.find((topic) => topic.id === takeaway.topic)?.label ?? takeaway.topic,
          1: takeaway.percent,
        });
      case 'top_support':
        return localize('com_agency_takeaway_top_support', {
          0: localize(SUPPORT_KEYS[takeaway.support]),
          1: takeaway.percent,
        });
      case 'no_goal':
        return localize('com_agency_takeaway_no_goal', { count: takeaway.conversations });
      default:
        return '';
    }
  };
  return (
    <Panel>
      <PanelHeading
        id={headingId}
        icon={Sparkles}
        tone="amber"
        title={localize('com_agency_takeaways_title')}
      />
      {found.length === 0 ? (
        <p className="text-text-secondary text-sm">{localize('com_agency_takeaways_empty')}</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-3">
          {found.map((takeaway) => {
            const Icon = ICONS[takeaway.kind];
            return (
              <li key={takeaway.kind} className="flex items-start gap-3">
                <ToneIcon icon={Icon} tone={TONE[takeaway.kind]} />
                <p className="text-text-primary pt-1 text-sm">{text(takeaway)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
