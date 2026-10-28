import { useId } from 'react';
import { Lightbulb } from 'lucide-react';
import type { TAgencyRecap } from 'librechat-data-provider';
import { SUPPORT_KEYS, rankSupport } from './labels';
import Panel, { PanelHeading } from './Panel';
import { useLocalize } from '~/hooks';

/**
 * The kinds of support the learner asked for in the period, as bars of one colour: the
 * length is the share of their labelled messages, and each bar is named and numbered.
 */
export default function Support({ recap }: { recap: TAgencyRecap }) {
  const localize = useLocalize();
  const headingId = useId();
  const ranked = rankSupport(recap.support);
  const total = ranked.reduce((sum, [, count]) => sum + count, 0);
  return (
    <Panel>
      <div aria-labelledby={headingId}>
        <PanelHeading
          id={headingId}
          icon={Lightbulb}
          tone="amber"
          title={localize('com_agency_support_title')}
        />
        <p className="text-text-secondary -mt-2 mb-3 text-sm">
          {localize('com_agency_support_help')}
        </p>
        {total === 0 ? (
          <p className="text-text-secondary text-sm">{localize('com_agency_support_empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {ranked.map(([type, count]) => {
              const percent = Math.round((count / total) * 100);
              return (
                <li key={type} className="flex flex-col gap-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="text-text-primary">{localize(SUPPORT_KEYS[type])}</span>
                    <span className="text-text-secondary tabular-nums">{percent}%</span>
                  </div>
                  <div
                    className="bg-surface-tertiary h-2 overflow-hidden rounded-full"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-label={localize(SUPPORT_KEYS[type])}
                  >
                    <div
                      className="bg-series-4 h-full rounded-full"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}
