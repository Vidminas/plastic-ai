import { useId } from 'react';
import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@librechat/client';
import type { TAgencyRecap } from 'librechat-data-provider';
import type { SignalLabel } from './labels';
import Panel, { PanelHeading } from './Panel';
import { rankSignals } from './labels';
import { messageLink } from '../links';
import { useLocalize } from '~/hooks';

const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/**
 * The messages in the period where the learner seems to have steered the AI: how many of each kind,
 * then the learner's own words from the latest ones, linked back to the chat. The marks are a
 * model's guess, and a count is not a score. A sign no longer configured is left out, since nothing
 * names it.
 */
export default function Signals({
  recap,
  signals,
}: {
  recap: TAgencyRecap;
  signals: SignalLabel[];
}) {
  const localize = useLocalize();
  const headingId = useId();
  const recentId = useId();
  const ranked = rankSignals(recap.signals.counts, signals);
  const recent = recap.signals.recent.flatMap((moment) => {
    const labels = signals.filter(({ id }) => moment.signals.includes(id));
    return labels.length > 0 ? [{ ...moment, labels }] : [];
  });
  return (
    <Panel>
      <PanelHeading
        id={headingId}
        icon={Compass}
        tone="teal"
        title={localize('com_agency_signals_title')}
      />
      <p className="text-text-secondary -mt-2 mb-3 text-sm">
        {localize('com_agency_signals_help')}
      </p>
      {ranked.length === 0 ? (
        <p className="text-text-secondary text-sm">{localize('com_agency_signals_empty')}</p>
      ) : (
        <>
          <ul aria-labelledby={headingId} className="flex flex-wrap gap-1.5">
            {ranked.map(({ signal, count }) => (
              <li
                key={signal.id}
                className="bg-surface-tertiary text-text-secondary flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs"
              >
                <span className="text-text-primary">{signal.label}</span>
                <span className="tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
          {recent.length > 0 && (
            <>
              <h3 id={recentId} className="text-text-secondary mt-4 mb-1 text-xs font-medium">
                {localize('com_agency_signals_recent')}
              </h3>
              <ul aria-labelledby={recentId} className="flex flex-col">
                {recent.map((moment) => (
                  <li key={moment.messageId} className="border-border-light border-t py-2.5">
                    <blockquote className="border-border-medium text-text-primary line-clamp-3 border-s-2 ps-3 text-sm">
                      {moment.excerpt}
                    </blockquote>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {moment.labels.map((signal) => (
                        <span
                          key={signal.id}
                          className="bg-surface-tertiary text-text-secondary rounded-full px-2 py-0.5 text-xs"
                        >
                          {signal.label}
                        </span>
                      ))}
                      <time dateTime={moment.at} className="text-text-secondary text-xs">
                        {when.format(new Date(moment.at))}
                      </time>
                      <Button asChild variant="ghost" size="sm" className="ms-auto">
                        <Link to={messageLink(moment.conversationId, moment.messageId)}>
                          {localize('com_agency_view_in_chat')}
                        </Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Panel>
  );
}
